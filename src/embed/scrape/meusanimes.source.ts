import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { ScrapeSource, ScrapeEpisodeResult } from './scrape-source.interface';
import {
  keepVideoUrls,
  extractVideoElements,
  extractAllIframes,
} from './extract';

/**
 * Adapter meusanimes.blog (Blogger / WordPress).
 * Mesma base do animesonlinecc: player é iframe (Blogger/embed externo) e/ou
 * <video> injetado após render. Extrai ambos.
 */
@Injectable()
export class MeusanimesScrapeSource implements ScrapeSource {
  readonly id = 'meusanimes';

  supports(url: string): boolean {
    return /meusanimes\.blog/i.test(url);
  }

  async extract(page: Page): Promise<ScrapeEpisodeResult> {
    const all = await extractVideoElements(page);
    const iframes = await extractAllIframes(page);
    return { videos: keepVideoUrls(all), iframes, cloudflare: false };
  }
}
