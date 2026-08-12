/**
 * Extractor — itera fontes candidatas e chama ScrapeService p/ extrair vídeo RAW.
 * Retorna a primeira sequência válida (candidates) ou lista de falhas p/ retry.
 *
 * Reusa ScrapeService.scrapeEpisodeVideo(url, sourceId, wrap=false) que já faz
 * extractHttp → Playwright fallback e CACHE SWR. O registro de health
 * (success/failure/latência) é centralizado no ScrapeService — este serviço
 * apenas consome o resultado. Concorrência limitada pelo Prisma.
 */
import { Injectable } from '@nestjs/common';
import { ScrapeService } from '@/embed/scrape/scrape.service';
import { SourceDiscovery } from './source-discovery.service';
import type { EpisodeCandidate } from './validator.service';

export interface ExtractResult {
  candidates: EpisodeCandidate[];
  triedSources: string[];
}

@Injectable()
export class Extractor {
  constructor(
    private readonly scrape: ScrapeService,
    private readonly discovery: SourceDiscovery,
  ) {}

  async extract(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
    episodeUrl?: string,
  ): Promise<ExtractResult> {
    const candidates = await this.discovery.candidates(
      animeSlug,
      episodeNumber,
      season,
      episodeUrl,
    );
    if (candidates.length === 0) {
      // probe falhou p/ todas — usa ordem base como fallback
      return { candidates: [], triedSources: [] };
    }

    const out: EpisodeCandidate[] = [];
    const tried: string[] = [];

    for (const c of candidates) {
      tried.push(c.sourceId);
      try {
        const result = await this.scrape.scrapeEpisodeVideo(
          c.url,
          c.sourceId,
          false,
        );
        const videoUrl = result.videos[0];
        if (!videoUrl) continue;

        out.push({
          videoUrl,
          sourceId: c.sourceId,
          embedUrl: c.url,
          thumbnailUrl: null,
          title: null,
          duration: null,
        });
      } catch (err) {
        console.error(
          `[WATCHTOWER] extract falhou ${c.sourceId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return { candidates: out, triedSources: tried };
  }
}
