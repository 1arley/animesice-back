/**
 * SourceDiscovery — monta lista de URLs candidatas por fonte para um episódio,
 * ordenadas por health (meusanimes prioritária base). Probe HTTP leve p/
 * descartar 404 antes de chamar Playwright.
 *
 * Templates:
 *  meusanimes:  https://meusanimes.blog/e/<slug>-<season>-episodio-<n>/
 *               (também sem sufixo p/ filmes/singles)
 *  animesonline: https://animesonline.cloud/episodio/<slug>-episodio-<n>
 *
 * Quando o catálogo fornece a URL real do episódio (episodeUrl), ela é usada
 * como primeira candidata da fonte correspondente — evitando divergência entre
 * a URL construída por template e a URL publicada (filmes usam /e/<slug>/,
 * enquanto episódios TV usam /e/<slug>-<season>-episodio-<n>/).
 */
import { Injectable } from '@nestjs/common';
import { HealthMonitor } from './health-monitor.service';
import { SOURCE_IDS, sourceEpisodeUrlVariants } from './watchtower.types';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface SourceCandidate {
  sourceId: string;
  url: string;
}

/** Classificação do probe HTTP de uma candidata. */
export type ProbeStatus = 'ok' | 'missing' | 'blocked' | 'inconclusive';

@Injectable()
export class SourceDiscovery {
  constructor(private readonly health: HealthMonitor) {}

  /**
   * Candidatas ordenadas por health da fonte.
   * @param episodeUrl URL real do episódio (vinda do catálogo) — se fornecida,
   *   vira a primeira candidata da fonte dona do host.
   */
  async candidates(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
    episodeUrl?: string,
  ): Promise<SourceCandidate[]> {
    const order = await this.health.rankedSources();
    const out: SourceCandidate[] = [];

    // Se o catálogo forneceu a URL real, prioriza a fonte dona dela.
    if (episodeUrl) {
      const explicit = this.explicitCandidate(episodeUrl);
      if (explicit && !(await this.health.isDisabled(explicit.sourceId))) {
        const status = await this.probeExists(explicit.url);
        if (status !== 'missing') out.push(explicit);
      }
    }

    const usedSources = new Set(out.map((c) => c.sourceId));
    const onlyExplicit = episodeUrl ? usedSources : new Set<string>();

    for (const sourceId of order) {
      if (onlyExplicit.has(sourceId)) continue;
      const urls = sourceEpisodeUrlVariants(
        sourceId,
        animeSlug,
        episodeNumber,
        season,
      );
      const ok: SourceCandidate[] = [];
      const blocked: SourceCandidate[] = [];
      const inconclusive: SourceCandidate[] = [];

      for (const url of urls) {
        const status = await this.probeExists(url);
        if (status === 'ok') ok.push({ sourceId, url });
        else if (status === 'blocked') blocked.push({ sourceId, url });
        else if (status === 'inconclusive')
          inconclusive.push({ sourceId, url });
        // 'missing' é descartado — página não existe.
      }

      if (ok.length > 0) {
        out.push(ok[0]!);
      } else if (inconclusive.length > 0) {
        out.push(inconclusive[0]!);
      } else if (blocked.length > 0) {
        out.push(blocked[0]!); // fallback: fonte existe mas pode estar sob challenge
      }
    }
    return out;
  }

  /**
   * Todas as URLs candidatas (sem probe) — p/ fallback quando probe falha.
   * Inclui TODAS as variantes de slug: sem o probe não dá para saber qual
   * existe, e o consumidor tenta em ordem. */
  allCandidates(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
  ): SourceCandidate[] {
    const out: SourceCandidate[] = [];
    for (const sourceId of SOURCE_IDS) {
      for (const url of sourceEpisodeUrlVariants(
        sourceId,
        animeSlug,
        episodeNumber,
        season,
      )) {
        out.push({ sourceId, url });
      }
    }
    return out;
  }

  /** Candidata explícita vinda do catálogo: detecta a fonte pelo host. */
  private explicitCandidate(episodeUrl: string): SourceCandidate | null {
    const lower = episodeUrl.toLowerCase();
    if (/meusanimes\.blog|meusdoramas\.club/i.test(lower)) {
      return { sourceId: 'meusanimes', url: episodeUrl };
    }
    if (/animefire\.io/i.test(lower)) {
      return { sourceId: 'animefire', url: episodeUrl };
    }
    if (/animesonlinecc\.to/i.test(lower)) {
      return { sourceId: 'animesonline', url: episodeUrl };
    }
    if (/animesonline\.cloud/i.test(lower)) {
      return { sourceId: 'animesonline', url: episodeUrl };
    }
    if (/animesdigital\.org/i.test(lower)) {
      return { sourceId: 'animesdigital', url: episodeUrl };
    }
    if (/topanimes\.net/i.test(lower)) {
      return { sourceId: 'topanimes', url: episodeUrl };
    }
    if (/animesorion\.cc|animexhd\.xyz/i.test(lower)) {
      return { sourceId: 'animesorion', url: episodeUrl };
    }
    return null;
  }

  exactCandidate(episodeUrl: string, sourceId: string): SourceCandidate | null {
    const candidate = this.explicitCandidate(episodeUrl);
    return candidate?.sourceId === sourceId ? candidate : null;
  }

  /**
   * Probe HEAD/GET classificado:
   *  - ok: 2xx/3xx — página existe.
   *  - missing: 404/410 — página não existe.
   *  - blocked: 403/429/5xx — existe mas indisponível (Cloudflare/rate-limit).
   *  - inconclusive: erro de rede/timeout — mantém como candidata.
   */
  private async probeExists(url: string): Promise<ProbeStatus> {
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

      if (res.status >= 200 && res.status < 400) return 'ok';
      if (res.status === 404 || res.status === 410) return 'missing';
      return 'blocked';
    } catch {
      return 'inconclusive'; // não prova nada — mantém como candidata
    }
  }
}
