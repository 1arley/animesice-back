import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { fetchSafeRaw } from '@/common/ssrf';
import { probeMediaUrlDead } from '@/common/media-probe';
import type {
  EpisodeUrlQuery,
  HttpExtractContext,
  ScrapeEpisodeResult,
  ScrapeSource,
} from './scrape-source.interface';
import {
  extractAllIframes,
  extractVideoElements,
  keepVideoUrls,
} from './extract';

/**
 * Host do player HLS: a página do episódio traz o iframe deste domínio.
 * sk-dc é a variante regional do mesmo player (medido em 17/10/2026).
 */
const PLAYER_HOST_RE =
  /https:\/\/((?:www\.)?sk-(?:api|dc)\.alibabacdn\.net)\/\?id=([^'"&\s]+)/i;

/**
 * Player atual (medido em 17/10/2026): o sk-api saiu do ar e a página passou a
 * servir <iframe src="https://csst.online/embed/<id>/">, que responde 301 para
 * incvideo1.online/embed/<id>/ com .mp4 direto por qualidade. Sem essa cadeia o
 * adapter jogava "sem player reconhecido" em 100% dos episódios.
 */
const EMBED_RE =
  /https?:\/\/(?:www\.)?(csst|fsst|incvideo1)\.online\/embed\/(\d+)/gi;

/**
 * `file:"[360p]https://...360p.mp4/,[720p]https://...720p.mp4/,[1080p]..."`.
 * A barra final é OBRIGATÓRIA p/ a CDN (get_file responde 404 sem ela,
 * 302→206 com ela) — o grupo captura `...mp4/` inteiro, não só até `.mp4`.
 */
const EMBED_FILE_RE = /\[(\d{3,4})p\](https?:\/\/[^\s"',[\]]+?\.mp4\/?)/gi;

/**
 * Espelhos que só entregam a mídia com browser de verdade (headed). Medido em
 * 17/10/2026: o filemoon é um SPA que faz attestation + proof-of-work antes de
 * pedir o HLS, e o mixdrop (.ag redireciona p/ .click) monta o player por JS.
 * Em headless os dois ficam 15s sem pedir nenhum `.mp4`/`.m3u8`.
 *
 * Devolvidos como playerToken para o ScrapeService resolver no Chromium via
 * Xvfb — é o mesmo caminho do player Blogger, sem código de browser novo.
 * `vgembed.com` e `streamtape.com` NÃO entram aqui: medidos 404 (o espelho
 * morreu lá fora, não falta extração).
 */
const BROWSER_MIRROR_RE =
  /^https:\/\/(?:www\.)?(?:filemoon\.sx|mixdrop\.ag|mxdrop\.click|embedwish\.com)\/e\//i;

/** Teto de espelhos por episódio: cada um custa uma aba de browser. */
const MAX_MIRRORS = 2;

/** src de <iframe> (players secundários). */
const IFRAME_SRC_RE = /<iframe[^>]+src=["']([^"']+)["']/gi;

/**
 * Link de episódio na página do anime: `/episodio/<slug>-episodio-<n>/`.
 * Aceita aspas simples E duplas — o tema emite as simples.
 */
const EPISODE_LINK_RE =
  /href=["'](https?:\/\/topanimes\.net\/episodio\/[^"']*?-episodio-(\d+)\/?)["']/gi;

const UA_ANIME_PAGE =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Modo que a própria página do player usa para obter o JSON de mídias. */
const PLAYER_API_MODE = 'to-salvando-seu-ip';

/** Qualidade no JSON -> peso. Maior primeiro (o player mapeia SD=1080p). */
const QUALITY_WEIGHT: Record<string, number> = {
  SD: 3,
  HD: 3,
  LD: 2,
  FD: 1,
};

/** Teto de probes de liveness (evita ~5s x N candidatas mortas). */
const MAX_PROBES = 4;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Adapter topanimes.net — WordPress/Dooplay pt-BR, extração HTTP pura.
 *
 * Validado na VPS em 13/10/2026: 200 sem challenge Cloudflare (o IP de
 * datacenter não é bloqueado, ao contrário de meusanimes.blog/animesonline).
 * O slug do episódio é IDÊNTICO ao nosso (template `-episodio-<n>`), então
 * não há mapeamento de catálogo.
 *
 * Cadeias (HTTP puro, sem navegador):
 *   A) embed (player atual, medido em 17/10/2026):
 *      1. GET /episodio/<slug>-episodio-<n> -> iframe `csst.online/embed/<id>`
 *         (às vezes embrulhado em `/aviso/?url=<url-encoded>`)
 *      2. GET <csst|fsst|incvideo1>.online/embed/<id>/ (o csst responde 301 p/
 *         incvideo1) -> `file:"[1080p]https://...mp4/,[720p]..."`
 *   B) sk-api (ainda em parte dos episódios):
 *      1. GET página -> <iframe src="https://sk-api.alibabacdn.net/?id=<ID>">
 *      2. GET sk-api...?id=<ID>&mode=to-salvando-seu-ip
 *         -> { status, midias: [{ qualidade, url }] }
 *
 * HLS do sk-api é assinado (hdnts=exp=..._hmac=...), TTL ~24h; o embed devolve
 * .mp4 direto. O host do CDN entra na confiança por procedência
 * (`trusted-media-hosts`), sem depender de EMBED_ALLOWED_HOSTS.
 */
@Injectable()
export class TopanimesScrapeSource implements ScrapeSource {
  readonly id = 'topanimes';

  supports(url: string): boolean {
    return /^https?:\/\/(?:[^/?#]+\.)?topanimes\.net(?:[/?#]|$)/i.test(url);
  }

  /** Slug local em ordem de tentativa: como está, sem sufixo dublado/legendado. */
  slugVariants(animeSlug: string): string[] {
    const stripped = animeSlug.replace(/-(?:dublado|legendado)(?:-\d+)?$/i, '');
    return [animeSlug, stripped].filter(
      (slug, i, all) => !!slug && all.indexOf(slug) === i,
    );
  }

  episodeUrl(animeSlug: string, episodeNumber: number): string {
    return `https://topanimes.net/episodio/${animeSlug}-episodio-${episodeNumber}/`;
  }

  templateUrls(query: EpisodeUrlQuery): string[] {
    return this.slugVariants(query.animeSlug).map((slug) =>
      this.episodeUrl(slug, query.episodeNumber),
    );
  }

  async resolveEpisodeUrls(query: EpisodeUrlQuery): Promise<string[]> {
    const resolved = await this.resolveEpisodeUrl(
      query.animeSlug,
      query.episodeNumber,
    );
    return resolved ? [resolved] : [];
  }

  /**
   * URL real do episódio.
   *
   * 1) variantes de slug (`bleach-dublado-2` -> `bleach`) na URL template;
   * 2) página do anime, que traz a lista real de episódios.
   *
   * O passo 2 é o que pega o resto: o topanimes indexa o episódio sob um slug
   * derivado do título original (`buchigire-...-chikara-de-sokoku-wo-ta` vira
   * `...-wo-tatakitsubushimasu`), que o template nunca adivinha.
   *
   * NOTA: os links usam `href='...'` (aspas simples) — um padrão que só
   * caseia aspas duplas devolve zero e faz a fonte parecer sem episódios.
   */
  async resolveEpisodeUrl(
    animeSlug: string,
    episodeNumber: number,
  ): Promise<string | null> {
    for (const slug of this.slugVariants(animeSlug)) {
      const url = this.episodeUrl(slug, episodeNumber);
      if (await this.exists(url)) return url;
    }
    return this.episodeLinkFromAnimePage(animeSlug, episodeNumber);
  }

  /** Procura o episódio na listagem da página do anime. */
  private async episodeLinkFromAnimePage(
    animeSlug: string,
    episodeNumber: number,
  ): Promise<string | null> {
    for (const slug of this.slugVariants(animeSlug)) {
      let html: string;
      try {
        html = await this.get(
          `https://topanimes.net/animes/${slug}/`,
          UA_ANIME_PAGE,
        );
      } catch {
        continue;
      }
      const hit = [...html.matchAll(EPISODE_LINK_RE)]
        .map((m) => ({ url: m[1]!, ep: Number(m[2]) }))
        .find((c) => c.ep === episodeNumber);
      if (hit) return hit.url;
    }
    return null;
  }

  async extractHttp(ctx: HttpExtractContext): Promise<ScrapeEpisodeResult> {
    let html: string;
    try {
      html = await this.get(ctx.episodeUrl, ctx.ua);
    } catch (err) {
      throw new Error(
        `topanimes: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // Token Blogger SD: o ScrapeService resolve para .mp4 googlevideo via
    // Playwright (mesmo caminho do animesonline). Catálogo antigo usa este
    // player; o novo usa HLS do sk-api.
    const playerTokens = [
      ...new Set(
        [...html.matchAll(IFRAME_SRC_RE)]
          .map((m) => m[1]!.replace(/&amp;/g, '&'))
          .filter((src) =>
            /^https:\/\/(?:www\.)?blogger\.com\/video\.g\?token=/i.test(src),
          ),
      ),
    ];

    // Metade dos players vem pelo wrapper `/aviso/?url=<url-encoded>`: o src do
    // iframe não traz o host do player, então a página é decodificada antes de
    // casar o embed.
    const decodedUrls = [...html.matchAll(/aviso\/\?url=([^'"&\s>]+)/g)].map(
      (m) => safeDecode(m[1]!),
    );
    const decoded = decodedUrls.join('\n');
    const embeds = [
      ...new Set(
        [...`${html}\n${decoded}`.matchAll(EMBED_RE)].map(
          (m) => `https://${m[1]!.toLowerCase()}.online/embed/${m[2]}/`,
        ),
      ),
    ];

    // O player sk-api é a via antiga: só vira fallback quando o embed não salva,
    // então a falha dele é guardada em vez de quebrada na hora.
    const player = html.match(PLAYER_HOST_RE);
    let playerError: unknown;
    let midias: string[] = [];
    if (player) {
      try {
        midias = await this.playerSources(player[1]!, player[2]!, ctx.ua);
      } catch (err) {
        playerError = err;
      }
    }
    if (midias.length > 0) {
      const videos = (
        await Promise.all(
          midias.slice(0, MAX_PROBES).map(async (url) => {
            return (await probeMediaUrlDead(url, true)) ? null : url;
          }),
        )
      ).filter((url): url is string => url !== null);
      return { videos, iframes: [], cloudflare: false, playerTokens };
    }

    // Vários embeds por página e alguns morrem (404): tenta em ordem até
    // um devolver mídia viva.
    for (const embedUrl of embeds) {
      const videos = await this.embedSources(embedUrl, ctx.ua).catch(
        () => [] as string[],
      );
      if (videos.length > 0) {
        return { videos, iframes: [], cloudflare: false, playerTokens };
      }
    }

    // Último recurso: espelhos que só entregam mídia em browser headed. Vão
    // como playerToken para o ScrapeService abrir com Xvfb.
    const mirrors = [
      ...new Set(
        decodedUrls
          .map((u) => u.split(/[?#]/)[0] ?? '')
          .filter((u) => BROWSER_MIRROR_RE.test(u)),
      ),
    ].slice(0, MAX_MIRRORS);
    const tokens = [...playerTokens, ...mirrors];

    if (tokens.length === 0) {
      // Sem embed e sem token: a falha do sk-api é a informação mais útil.
      if (playerError instanceof Error) throw playerError;
      throw new Error(
        `topanimes: ${ctx.episodeUrl} sem player reconhecido (sk-api/Blogger)`,
      );
    }
    return { videos: [], iframes: [], cloudflare: false, playerTokens: tokens };
  }

  /** JSON do player, ordenado por qualidade (maior primeiro). */
  private async playerSources(
    host: string,
    playerId: string,
    ua: string,
  ): Promise<string[]> {
    const url = `https://${host}/?id=${encodeURIComponent(
      playerId,
    )}&mode=${PLAYER_API_MODE}`;
    const raw = await this.get(url, ua, 'application/json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`topanimes: resposta JSON invalida do player`);
    }
    const data = parsed as {
      status?: string;
      message?: string;
      midias?: { qualidade?: string; url?: string }[];
    };
    if (data.status !== 'success') {
      throw new Error(
        `topanimes: player respondeu "${data.status ?? 'desconhecido'}"${
          data.message ? ` (${data.message})` : ''
        }`,
      );
    }
    return (data.midias ?? [])
      .filter((m) => !!m.url && /^https?:\/\//i.test(m.url))
      .map((m) => ({
        url: m.url!,
        weight: QUALITY_WEIGHT[m.qualidade ?? ''] ?? 0,
      }))
      .sort((a, b) => b.weight - a.weight)
      .map((m) => m.url);
  }

  /**
   * Player embed: segue o embed (csst/fsst/incvideo1) e extrai os .mp4 por
   * qualidade. O `file` é uma lista `,[<label>]` — não é JSON, então regex.
   */
  private async embedSources(embedUrl: string, ua: string): Promise<string[]> {
    const html = await this.get(embedUrl, ua);
    const byResolution = new Map<number, string>();
    for (const [, label, url] of html.matchAll(EMBED_FILE_RE)) {
      const resolution = Number(label);
      if (!byResolution.has(resolution))
        // CDN do player exige a barra final: sem ela o get_file responde 404
        // (302→206 com barra). Nunca normalizar removendo-a.
        byResolution.set(resolution, url!);
    }
    const candidates = [...byResolution.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, MAX_PROBES);
    const videos: string[] = [];
    for (const [, url] of candidates) {
      if (!(await probeMediaUrlDead(url, true))) videos.push(url);
    }
    return videos;
  }

  private async exists(url: string): Promise<boolean> {
    const response = await fetchSafeRaw(
      url,
      {
        headers: {
          'user-agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          accept: 'text/html',
        },
      },
      15_000,
    );
    const dispatcher = response.dispatcher;
    try {
      await response.response.body?.cancel();
      return response.response.status >= 200 && response.response.status < 400;
    } finally {
      await dispatcher.close();
    }
  }

  private async get(
    url: string,
    ua: string,
    accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  ): Promise<string> {
    let response: Response;
    let dispatcher: import('undici').Dispatcher;
    try {
      ({ response, dispatcher } = await fetchSafeRaw(
        url,
        {
          headers: {
            'user-agent': ua,
            'accept-language': 'pt-BR,pt;q=0.9',
            accept,
            referer: 'https://topanimes.net/',
          },
        },
        15_000,
      ));
    } catch (err) {
      const cause = err instanceof Error ? err.cause : undefined;
      throw new Error(
        `fetch failed para ${url}: ${err instanceof Error ? err.message : String(err)}${cause ? ` (causa: ${cause instanceof Error ? cause.message : JSON.stringify(cause)})` : ''}`,
        { cause: err },
      );
    }
    try {
      if (!response.ok) {
        throw new Error(`${url} retornou ${response.status}`);
      }
      return await response.text();
    } finally {
      await dispatcher.close();
    }
  }

  /** Fallback Playwright (o caminho HTTP acima dispensa browser). */
  async extract(page: Page): Promise<ScrapeEpisodeResult> {
    const videos = keepVideoUrls(await extractVideoElements(page));
    return {
      videos,
      iframes: await extractAllIframes(page),
      cloudflare: false,
    };
  }
}
