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

/** URLs .mp4/.m3u8 inline no HTML (config de player / JSON de fontes). */
const MEDIA_URL_RE = /https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m3u8)(?:[^\s"'<>\\]*)/gi;

/** src de tags <source>/<video> (players renderizados server-side). */
const MEDIA_ATTR_RE = /<(?:source|video)[^>]*\bsrc=["']([^"']+)["']/gi;

/** src de <iframe> (players secundários). */
const IFRAME_SRC_RE = /<iframe[^>]+src=["']([^"']+)["']/gi;

/** Teto de probes de liveness por página (evita ~5s × N candidatas mortas). */
const MAX_PROBES = 4;

/**
 * Adapter animesonline.cloud — WordPress pt-BR da rede "AnimesOnline".
 *
 * Validado na VPS em 28/09/2026: homepage/anime/página de episódio em HTTP 200
 * sem challenge Cloudflare (0,4–2,4s), e o HTML do episódio já traz o vídeo
 * server-side — ex. ao-no-hako ep 23:
 *   <video><source src="https://animeflix.blog/Animes/.../23.mp4">
 *   <iframe src="https://www.blogger.com/video.g?token=...">   (servidor SD)
 *
 * Caminho HTTP puro (extractHttp):
 *   1. GET /episodio/<slug>-episodio-<n> -> candidatas .mp4/.m3u8 + token Blogger.
 *   2. Filtra candidatas mortas via probe (Range bytes=0-0): o primeiro
 *      <source> do site aponta para cld.pt, cujo DNS está morto.
 *   3. Sem .mp4 vivo -> devolve o token Blogger em `playerTokens`, que o
 *      ScrapeService resolve com Playwright (mesmo fluxo do meusanimes).
 *
 * Sem browser no caminho feliz. O host do .mp4 (animeflix.blog) precisa estar
 * em EMBED_ALLOWED_HOSTS para o proxy de mídia servir o stream.
 */
@Injectable()
export class AnimesonlineScrapeSource implements ScrapeSource {
  readonly id = 'animesonline';

  supports(url: string): boolean {
    return /^https?:\/\/(?:[^/?#]+\.)?animesonline\.cloud(?:[/?#]|$)/i.test(
      url,
    );
  }

  async extractHttp(ctx: HttpExtractContext): Promise<ScrapeEpisodeResult> {
    let html: string;
    try {
      html = await this.get(ctx.episodeUrl, ctx.ua);
    } catch (err) {
      throw new Error(
        `animesonline: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    const candidates = [...new Set(this.collectMedia(html))];
    const videos: string[] = [];
    for (const url of candidates.slice(0, MAX_PROBES)) {
      if (!(await probeMediaUrlDead(url, true))) videos.push(url);
    }

    const playerTokens = [...new Set(this.collectBloggerTokens(html))];

    return {
      videos,
      iframes: [],
      cloudflare: false,
      playerTokens,
    };
  }

  /** Candidatas diretas na ordem do HTML: <source>/<video> primeiro, inline depois. */
  private collectMedia(html: string): string[] {
    const out: string[] = [];
    for (const [, src] of html.matchAll(MEDIA_ATTR_RE)) {
      out.push(this.decodeHtml(src!));
    }
    for (const [inline] of html.matchAll(MEDIA_URL_RE)) {
      out.push(this.decodeHtml(inline));
    }
    return out.filter((url) => /^https?:\/\//i.test(url));
  }

  /** Tokens do player Blogger SD — resolvíveis para .mp4 via Playwright. */
  private collectBloggerTokens(html: string): string[] {
    const out: string[] = [];
    for (const [, src] of html.matchAll(IFRAME_SRC_RE)) {
      const url = this.decodeHtml(src!);
      if (/^https?:\/\/(?:www\.)?blogger\.com\/video\.g\?token=/i.test(url)) {
        out.push(url);
      }
    }
    return out;
  }

  private decodeHtml(value: string): string {
    return value.replace(/&amp;/g, '&');
  }

  private async get(url: string, ua: string): Promise<string> {
    let response: Response;
    let dispatcher: import('undici').Dispatcher;
    try {
      ({ response, dispatcher } = await fetchSafeRaw(
        url,
        {
          headers: {
            'user-agent': ua,
            'accept-language': 'pt-BR,pt;q=0.9',
            accept:
              'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            referer: 'https://animesonline.cloud/',
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

  /** Fallback Playwright (fluxo genérico de extração da página). */
  async extract(page: Page): Promise<ScrapeEpisodeResult> {
    const videos = keepVideoUrls(await extractVideoElements(page));
    return {
      videos,
      iframes: await extractAllIframes(page),
      cloudflare: false,
    };
  }
}
