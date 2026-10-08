import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { runRustScraper } from './rust-scraper';
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

/** Adapter for animesdigital.org pages with direct HLS iframe URLs. */
@Injectable()
export class AnimesdigitalScrapeSource implements ScrapeSource {
  readonly id = 'animesdigital';

  supports(url: string): boolean {
    return /^https?:\/\/(?:[^/?#]+\.)?animesdigital\.org(?:[/?#]|$)/i.test(url);
  }

  async extractHttp(ctx: HttpExtractContext): Promise<ScrapeEpisodeResult> {
    const binary = process.env.ANIMESDIGITAL_RUST_BIN;
    if (binary) {
      const shadow = process.env.ANIMESDIGITAL_RUST_MODE === 'shadow';
      try {
        const result = await runRustScraper(binary, ctx);
        if (shadow) console.warn('[SCRAPE] Rust animesdigital', result);
        else {
          if (!result.videos.length)
            throw new Error('Scraper Rust retornou resultado vazio.');
          return result;
        }
      } catch (error) {
        console.warn(
          `[SCRAPE] Rust animesdigital falhou; usando Node: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const { response, dispatcher } = await fetchSafeRaw(
      ctx.episodeUrl,
      { headers: { 'user-agent': ctx.ua, accept: 'text/html' } },
      15_000,
    );
    try {
      if (!response.ok)
        throw new Error(`${ctx.episodeUrl} retornou ${response.status}`);
      const html = await response.text();
      const urls = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)]
        .map((m) => m[1]!.replace(/&amp;/g, '&'))
        .flatMap((src) => {
          try {
            const hls = new URL(src).searchParams.get('d');
            return hls && /\.(?:m3u8|mp4)(?:$|[?#])/i.test(hls) ? [hls] : [];
          } catch {
            return [];
          }
        });
      return { videos: [...new Set(urls)], iframes: [], cloudflare: false };
    } finally {
      await dispatcher.close();
    }
  }

  async extract(page: Page): Promise<ScrapeEpisodeResult> {
    const videos = keepVideoUrls(await extractVideoElements(page));
    return {
      videos,
      iframes: await extractAllIframes(page),
      cloudflare: false,
    };
  }
}
