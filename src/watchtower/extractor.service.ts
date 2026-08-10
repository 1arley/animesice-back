/**
 * Extractor — itera fontes candidatas, chama ScrapeService p/ extrair vídeo RAW,
 * registra outcome no HealthMonitor. Retorna primeira sequência válida ( campaigners) ou
 * lista de falhas p/ retry.
 *
 * Reusa ScrapeService.scrapeEpisodeVideo(url, sourceId, wrap=false) que já faz
 * extractHttp → Playwright fallback. Concurrence limitada pelo Prisma.
 */
import { Injectable } from '@nestjs/common';
import { ScrapeService } from '@/embed/scrape/scrape.service';
import { HealthMonitor } from './health-monitor.service';
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
    private readonly health: HealthMonitor,
    private readonly discovery: SourceDiscovery,
  ) {}

  async extract(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
  ): Promise<ExtractResult> {
    const candidates = await this.discovery.candidates(
      animeSlug,
      episodeNumber,
      season,
    );
    if (candidates.length === 0) {
      // probe falhou p/ todas — usa ordem base como fallback
      return { candidates: [], triedSources: [] };
    }

    const out: EpisodeCandidate[] = [];
    const tried: string[] = [];

    for (const c of candidates) {
      tried.push(c.sourceId);
      const t0 = Date.now();
      try {
        const result = await this.scrape.scrapeEpisodeVideo(
          c.url,
          c.sourceId,
          false,
        );
        const videoUrl = result.videos[0];
        if (!videoUrl) {
          await this.health.recordFailure(c.sourceId);
          continue;
        }
        const latency = Date.now() - t0;
        await this.health.recordSuccess(c.sourceId, latency);

        out.push({
          videoUrl,
          sourceId: c.sourceId,
          thumbnailUrl: null,
          title: null,
          duration: null,
        });
      } catch (err) {
        await this.health.recordFailure(c.sourceId);
        console.error(
          `[WATCHTOWER] extract falhou ${c.sourceId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return { candidates: out, triedSources: tried };
  }
}
