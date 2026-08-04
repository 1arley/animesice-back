import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { ScrapeSource, ScrapeEpisodeResult } from './scrape-source.interface';
import {
  keepVideoUrls,
  extractVideoElements,
  extractAllIframes,
} from './extract';

/**
 * Adapter animesonlinecc.to (tema Dooplay / WordPress).
 *
 * Característica observada (probe em /episodio/<slug>/):
 *  - HTML estático traz 1 iframe de vídeo Blogger (blogger.com/video.g?token=),
 *    sem .mp4/.m3u8 diretos.
 *  - O player Dooplay é injetado client-side (AJAX dooplay_player). O .mp4/.m3u8
 *    (se houver) aparece só após o render.
 *
 * Estratégia: renderiza, extrai <video>/<source> (.mp4/.m3u8) E iframes.
 * O embed via proxy (EmbedService.proxyHtml) também funciona a partir do
 * iframe Blogger que já está no HTML estático.
 */
@Injectable()
export class AnimesonlineccScrapeSource implements ScrapeSource {
  readonly id = 'animesonlinecc';

  supports(url: string): boolean {
    return /animesonlinecc\./i.test(url);
  }

  async extract(page: Page): Promise<ScrapeEpisodeResult> {
    const all = await extractVideoElements(page);
    const iframes = await extractAllIframes(page);
    // Prioriza iframes de player (Blogger/YouTube/embedX) — ou `.mp4/.m3u8`.
    const playerIframes = iframes.filter((u) =>
      /blogger\.com\/video|youtube\.com\/embed|\/embed\/|player|streamtape|mixdrop|doodstream|hydrax/i.test(
        u,
      ),
    );
    const rest = iframes.filter((u) => !playerIframes.includes(u));
    return {
      videos: keepVideoUrls(all),
      iframes: [...playerIframes, ...rest],
      cloudflare: false,
    };
  }
}
