/**
 * SourceDiscovery — monta lista de URLs candidatas por fonte para um episódio,
 * ordenadas por health (meusanimes prioritária base). Probe HTTP leve p/
 * descartar 404 antes de chamar Playwright.
 *
 * Templates:
 *  meusanimes:  https://meusanimes.blog/e/<slug>-<season>-episodio-<n>/
 *               (também sem sufixo p/ filmes/singles)
 *  animefire:   https://animefire.io/animes/<slug>/<n>
 *  animesonlinecc: https://animesonlinecc.to/episodio/<slug>-episodio-<n>/
 */
import { Injectable } from '@nestjs/common';
import { HealthMonitor } from './health-monitor.service';
import { SOURCE_IDS, sourceEpisodeUrl } from './watchtower.types';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface SourceCandidate {
  sourceId: string;
  url: string;
}

@Injectable()
export class SourceDiscovery {
  constructor(private readonly health: HealthMonitor) {}

  async candidates(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
  ): Promise<SourceCandidate[]> {
    const order = await this.health.rankedSources();
    const out: SourceCandidate[] = [];

    for (const sourceId of order) {
      const urls = this.urlsFor(sourceId, animeSlug, episodeNumber, season);
      for (const url of urls) {
        if (await this.probeExists(url)) {
          out.push({ sourceId, url });
          break; // primeira URL válida da fonte basta
        }
      }
    }
    return out;
  }

  /** Todas as URLs candidatas (sem probe) — p/ fallback quando probe falha. */
  allCandidates(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
  ): SourceCandidate[] {
    const out: SourceCandidate[] = [];
    const order = SOURCE_IDS;
    for (const sourceId of order) {
      const urls = this.urlsFor(sourceId, animeSlug, episodeNumber, season);
      if (urls[0]) out.push({ sourceId, url: urls[0] });
    }
    return out;
  }

  private urlsFor(
    sourceId: string,
    slug: string,
    ep: number,
    season: number = 1,
  ): string[] {
    const base = sourceEpisodeUrl(sourceId, slug, ep, season);
    if (!base) return [];
    if (sourceId === 'meusanimes') {
      return [
        base,
        `https://meusanimes.blog/e/${slug}/`,
        `https://meusanimes.blog/e/${slug}-episodio-${ep}/`,
      ];
    }
    return [base];
  }

  /** Probe HEAD/GET: false se 404. true se 200 ou erro de rede (inconclusivo). */
  private async probeExists(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'user-agent': UA,
          accept: 'text/html',
          'accept-language': 'pt-BR',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      await res.body?.cancel();
      return res.status !== 404;
    } catch {
      return true; // inconclusivo — inclui como candidata
    }
  }
}
