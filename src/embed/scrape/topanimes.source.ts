import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { fetchSafeRaw } from '@/common/ssrf';
import { probeMediaUrlDead } from '@/common/media-probe';
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

/** Host do player HLS: a página do episódio traz o iframe deste domínio. */
const PLAYER_HOST_RE = /https:\/\/sk-api\.alibabacdn\.net\/\?id=([^'"&\s]+)/i;

/** src de <iframe> (players secundários). */
const IFRAME_SRC_RE = /<iframe[^>]+src=["']([^"']+)["']/gi;

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

/**
 * Adapter topanimes.net — WordPress/Dooplay pt-BR, extração HTTP pura.
 *
 * Validado na VPS em 13/10/2026: 200 sem challenge Cloudflare (o IP de
 * datacenter não é bloqueado, ao contrário de meusanimes.blog/animesonline).
 * O slug do episódio é IDÊNTICO ao nosso (template `-episodio-<n>`), então
 * não há mapeamento de catálogo.
 *
 * Cadeia (2 requests, sem navegador):
 *   1. GET /episodio/<slug>-episodio-<n>
 *        -> <iframe src="https://sk-api.alibabacdn.net/?id=<ID>">
 *   2. GET sk-api.alibabacdn.net/?id=<ID>&mode=to-salvando-seu-ip
 *        -> { status, midias: [{ qualidade, url }] }
 *
 * `url` é HLS (.m3u8) assinado (hdnts=exp=..._hmac=...), TTL ~24h. O proxy
 * de mídia já reescreve playlist e roteia segmentos (.ts), então o host do
 * CDN precisa estar em EMBED_ALLOWED_HOSTS.
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

  /**
   * URL real do episódio: tenta as variantes de slug e devolve a primeira
   * que responde 200 (o topanimes nem sempre tem o sufixo `-dublado`).
   */
  async resolveEpisodeUrl(
    animeSlug: string,
    episodeNumber: number,
  ): Promise<string | null> {
    for (const slug of this.slugVariants(animeSlug)) {
      const url = this.episodeUrl(slug, episodeNumber);
      if (await this.exists(url)) return url;
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

    const playerId = html.match(PLAYER_HOST_RE)?.[1];
    if (!playerId) {
      if (playerTokens.length === 0) {
        throw new Error(
          `topanimes: ${ctx.episodeUrl} sem player reconhecido (sk-api/Blogger)`,
        );
      }
      return { videos: [], iframes: [], cloudflare: false, playerTokens };
    }

    const midias = await this.playerSources(playerId, ctx.ua);
    const candidates = midias.slice(0, MAX_PROBES);

    const videos: string[] = [];
    for (const url of candidates) {
      if (!(await probeMediaUrlDead(url, true))) videos.push(url);
    }

    return {
      videos,
      iframes: [],
      cloudflare: false,
      playerTokens,
    };
  }

  /** JSON do player, ordenado por qualidade (maior primeiro). */
  private async playerSources(playerId: string, ua: string): Promise<string[]> {
    const url = `https://sk-api.alibabacdn.net/?id=${encodeURIComponent(
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
