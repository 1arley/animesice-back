import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import {
  ScrapeSource,
  ScrapeEpisodeResult,
  HttpExtractContext,
} from './scrape-source.interface';
import {
  keepVideoUrls,
  extractVideoElements,
  extractAllIframes,
} from './extract';

/**
 * Origem do site fonte, injetada como Referer/Origin na chamada à CDN interna
 * /video (anti-hotlinking + obriga o JSON a resolver).
 */
const ANIMEFIRE_ORIGIN = 'https://animefire.io';

/** Regex p/ extrair o atributo data-video-src (URL interna /video/...). */
const DATA_VIDEO_SRC_RE = /data-video-src=["']([^"']+)["']/i;

/**
 * Adapter animefire.io.
 *
 * Caminho HTTP puro (extractHttp): porta o método `data-video-src` do GoAnime
 * (internal/scraper/providers/animefire/client.go GetEpisodeStreamURL):
 *   1. GET /animes/<slug>/<ep> -> HTML contém data-video-src=".../video/<slug>?...".
 *   2. GET /video/<slug>?...  (com Referer/Origin animefire.io) -> JSON
 *      { data:[{ src:"https://lightspeedst.net/.../hd/1.mp4?token=...&ip=...",
 *               label:"720p" }, ...] }.
 *   3. src vem com escapes \/ (unescape).
 * Sem Cloudflare (validado); sem Playwright; devolve RAW.
 *
 * Caminho Playwright (extract): fallback inerte — video.js currentSrc/<source>.
 */
@Injectable()
export class AnimefireScrapeSource implements ScrapeSource {
  readonly id = 'animefire';

  supports(url: string): boolean {
    return /animefire\./i.test(url);
  }

  /**
   * Extração HTTP pura. Devolve `videos` RAW (URLs .mp4 da CDN lightspeedst.net,
   * token IP-bound ao IP de saida do backend — resolvido em stream pelo proxy
   * de midia, ver EmbedService.proxyMedia).
   */
  async extractHttp(ctx: HttpExtractContext): Promise<ScrapeEpisodeResult> {
    // Step 1: página do episódio -> data-video-src.
    const pageRes = await fetch(ctx.episodeUrl, {
      headers: {
        'user-agent': ctx.ua,
        'accept-language': 'pt-BR,pt;q=0.9',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    console.log(
      `[AF] extractHttp url='${ctx.episodeUrl}' status=${pageRes.status} final='${pageRes.url}'`,
    );
    if (!pageRes.ok) {
      throw new Error(
        `animefire: página do episódio retornou ${pageRes.status} para url='${ctx.episodeUrl}' final='${pageRes.url}'`,
      );
    }
    const html = await pageRes.text();

    const m = html.match(DATA_VIDEO_SRC_RE);
    if (!m || !m[1]) {
      throw new Error('animefire: data-video-src não encontrado no HTML.');
    }
    const videoPageUrl = m[1];

    // Step 2: página interna /video -> JSON de fontes.
    const videoRes = await fetch(videoPageUrl, {
      headers: {
        'user-agent': ctx.ua,
        referer: `${ANIMEFIRE_ORIGIN}/`,
        origin: ANIMEFIRE_ORIGIN,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      redirect: 'follow',
    });
    if (!videoRes.ok) {
      throw new Error(`animefire: /video retornou ${videoRes.status}`);
    }
    const json = (await videoRes.json()) as {
      data?: Array<{ src?: string; label?: string }>;
    };

    if (!json.data || json.data.length === 0) {
      throw new Error('animefire: JSON de fontes vazio.');
    }

    // Unescape \/ e ordena por qualidade (hd/720p primeiro, depois sd).
    const srcs = json.data
      .map((d) => (d.src || '').replace(/\\\//g, '/'))
      .filter((s) => /^https?:\/\//i.test(s) && /\.mp4($|\?|#)/i.test(s));

    // Preferência: hd (720p) primeiro. Mantém ordem original se não houver hd.
    const hd = srcs.find((s) => /\/hd\//i.test(s));
    const ordered = hd ? [hd, ...srcs.filter((s) => s !== hd)] : srcs;

    return { videos: [...new Set(ordered)], iframes: [], cloudflare: false };
  }

  /** Fallback Playwright (inerte em prod — animefire usa extractHttp). */
  async extract(page: Page): Promise<ScrapeEpisodeResult> {
    const all = await extractVideoElements(page);
    const iframes = await extractAllIframes(page);
    return { videos: keepVideoUrls(all), iframes, cloudflare: false };
  }
}
