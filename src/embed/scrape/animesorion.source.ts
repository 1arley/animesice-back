import { Injectable } from '@nestjs/common';
import type { AudioType } from '@prisma/client';
import type { Page } from 'playwright';
import { fetchSafeRaw } from '@/common/ssrf';
import type {
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
 * Hosts da rede "Animes Online" (Kitsune): o catálogo e a página de episódio
 * usam o template `<slug>-<season>x<ep>`, e ambos apontam para o MESMO player.
 */
const KIT_HOSTS: Record<string, { host: string; serieRe: RegExp }> = {
  animesorion: {
    host: 'https://animesorion.cc',
    serieRe: /myembed\.biz\/serie\/(\d+)\/(\d+)\/(\d+)/i,
  },
  animexhd: {
    host: 'https://animexhd.xyz',
    serieRe: /myembed\.biz\/serie\/(\d+)\/(\d+)\/(\d+)/i,
  },
};

/** API do player: devolve os `options[].embed` (tokens Blogger). */
const PLAYER_API = 'https://playerflix.ink/inc/Ajax.php';

interface PlayerOption {
  embed?: string;
  lang?: string;
  label?: string;
  id?: string;
}

/**
 * Adapter animesorion.cc / animexhd.xyz — mesma rede, mesmo player.
 *
 * Validado na VPS em 13/10/2026: ambos respondem 200 sem challenge Cloudflare
 * (o IP de datacenter NÃO é bloqueado, diferente de meusanimes/animesonline).
 * Os dois sites são espelhos: `one-piece` é `serie/37854` nos dois.
 *
 * Cadeia (2 requests HTTP, sem browser até o último passo):
 *   1. GET /episodios/<slug>-<season>x<ep>
 *        -> <iframe src="https://myembed.biz/serie/<id>/<s>/<e>">
 *   2. GET myembed.biz/serie/<id>/<s>/<e>   (precisa de Referer do próprio host)
 *        -> <iframe src="https://playerflix.ink/serie/<id>/<s>/<e>">
 *   3. GET playerflix.ink/inc/Ajax.php?type=tv&id=<id>&season=<s>&episode=<e>
 *        (header X-Requested-With: XMLHttpRequest)
 *        -> { status, data: { options: [{ embed: <token Blogger>, lang }] } }
 *
 * O passo 3 devolve tokens do player Blogger, não mídia direta: devolvidos em
 * `playerTokens` para o ScrapeService resolver em .mp4 googlevideo via
 * Playwright — o mesmo caminho que meusanimes/animesonline já usam.
 *
 * NOTA: `playerflix.ink` responde 0 bytes sem o header Referer correto. Sem
 * ele a cadeia quebra em silêncio.
 */
@Injectable()
export class AnimesorionScrapeSource implements ScrapeSource {
  readonly id = 'animesorion';

  supports(url: string): boolean {
    return /^https?:\/\/(?:[^/?#]+\.)?(?:animesorion\.cc|animexhd\.xyz)(?:[/?#]|$)/i.test(
      url,
    );
  }

  /** Catálogo da fonte a partir da URL da página (animesorion/animexhd). */
  private hostOf(url: string): string {
    return /^https?:\/\/(?:[^/?#]+\.)?animexhd\.xyz(?:[/?#]|$)/i.test(url)
      ? KIT_HOSTS.animexhd!.host
      : KIT_HOSTS.animesorion!.host;
  }

  /** Slug local em ordem de tentativa: como está, sem sufixo dublado. */
  slugVariants(animeSlug: string): string[] {
    const stripped = animeSlug.replace(/-(?:dublado|legendado)(?:-\d+)?$/i, '');
    return [animeSlug, stripped].filter(
      (slug, i, all) => !!slug && all.indexOf(slug) === i,
    );
  }

  episodeUrl(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
    host = KIT_HOSTS.animesorion!.host,
  ): string {
    return `${host}/episodios/${animeSlug}-${season}x${episodeNumber}/`;
  }

  /**
   * URL real do episódio: as variantes de slug são tentadas em ordem e a
   * primeira que responde 2xx/3xx vence. Nossas slugs carregam áudio
   * (`bleach-dublado-2`) que a fonte não indexa (`bleach`).
   */
  async resolveEpisodeUrl(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
    host = KIT_HOSTS.animesorion!.host,
  ): Promise<string | null> {
    for (const slug of this.slugVariants(animeSlug)) {
      const url = this.episodeUrl(slug, episodeNumber, season, host);
      if (await this.exists(url)) return url;
    }
    return null;
  }

  async extractHttp(ctx: HttpExtractContext): Promise<ScrapeEpisodeResult> {
    const serie = await this.resolveSerieId(ctx.episodeUrl);
    if (!serie) {
      throw new Error(`${ctx.episodeUrl} sem iframe myembed.biz`);
    }
    const requested = ctx.episodeUrl.match(/-(\d+)x(\d+)(?:\/|$)/i);
    if (
      !requested ||
      serie.season !== Number(requested[1]) ||
      serie.episode !== Number(requested[2])
    ) {
      throw new Error(`${ctx.episodeUrl} aponta para episódio diferente`);
    }

    const options = await this.playerOptions(
      serie.id,
      serie.season,
      serie.episode,
    );
    const playerTokens = [
      ...new Set(
        options
          .filter((option) => this.matchesAudio(option, ctx.audio))
          .map((o) => o.embed)
          .filter((e): e is string => !!e && /^https?:\/\//i.test(e)),
      ),
    ];

    if (playerTokens.length === 0) {
      throw new Error(`playerflix sem player disponível p/ serie ${serie.id}`);
    }

    return { videos: [], iframes: [], cloudflare: false, playerTokens };
  }

  private matchesAudio(option: PlayerOption, audio?: AudioType): boolean {
    if (!audio) return true;
    const label = `${option.label ?? ''}`
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (!label) return false;
    return audio === 'DUBLADO'
      ? /\b(dublado|dub|portugu[eê]s|pt[-_ ]?br)\b/.test(label)
      : /\b(legendado|sub(?:title|titles)?|original|japanese|ja[-_ ]?jp)\b/.test(
          label,
        );
  }

  /** id/season/episode do player, extraído do iframe myembed.biz. */
  private async resolveSerieId(
    episodeUrl: string,
  ): Promise<{ id: string; season: number; episode: number } | null> {
    let html: string;
    try {
      html = await this.get(episodeUrl, 'https://topanimes.net/');
    } catch (err) {
      throw new Error(
        `animesorion: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const kit = this.hostOf(episodeUrl);
    const re =
      kit === KIT_HOSTS.animexhd!.host
        ? KIT_HOSTS.animexhd!.serieRe
        : KIT_HOSTS.animesorion!.serieRe;
    const hit = html.match(re);
    if (!hit) return null;
    return {
      id: hit[1]!,
      season: Number(hit[2]) || 1,
      episode: Number(hit[3]) || 1,
    };
  }

  /**
   * GET playerflix.ink/inc/Ajax.php -> options de player.
   *
   * O host responde 0 bytes sem Referer: o mesmo `/serie/...` que a página
   * carrega responde HTML aqui, mas o Ajax só entrega JSON com o referer.
   */
  private async playerOptions(
    id: string,
    season: number,
    episode: number,
  ): Promise<PlayerOption[]> {
    const url = `${PLAYER_API}?${new URLSearchParams({
      type: 'tv',
      id,
      season: String(season),
      episode: String(episode),
    }).toString()}`;

    let response: Response;
    let dispatcher: import('undici').Dispatcher;
    try {
      ({ response, dispatcher } = await fetchSafeRaw(
        url,
        {
          headers: {
            'user-agent': UA,
            accept: 'application/json, text/plain, */*',
            'x-requested-with': 'XMLHttpRequest',
            referer: `https://playerflix.ink/serie/${id}/${season}/${episode}`,
          },
        },
        15_000,
      ));
    } catch (err) {
      throw new Error(
        `fetch failed p/ playerflix: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    let raw: string;
    try {
      if (!response.ok)
        throw new Error(`playerflix retornou ${response.status}`);
      raw = await response.text();
    } finally {
      await dispatcher.close();
    }

    if (!raw) {
      throw new Error('playerflix respondeu vazio (falta Referer do player?)');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('playerflix nao devolveu JSON');
    }
    const data = parsed as {
      status?: boolean;
      data?: { options?: PlayerOption[] };
    };
    if (!data.status) throw new Error('playerflix respondeu status=false');
    return data.data?.options ?? [];
  }

  private async exists(url: string): Promise<boolean> {
    const { response, dispatcher } = await fetchSafeRaw(
      url,
      {
        headers: {
          'user-agent': UA,
          accept: 'text/html',
          referer: `${this.hostOf(url)}/`,
        },
      },
      15_000,
    );
    try {
      await response.body?.cancel();
      return response.status >= 200 && response.status < 400;
    } finally {
      await dispatcher.close();
    }
  }

  private async get(url: string, referer: string): Promise<string> {
    const { response, dispatcher } = await fetchSafeRaw(
      url,
      {
        headers: {
          'user-agent': UA,
          'accept-language': 'pt-BR,pt;q=0.9',
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          referer,
        },
      },
      15_000,
    );
    try {
      if (!response.ok) throw new Error(`${url} retornou ${response.status}`);
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

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
