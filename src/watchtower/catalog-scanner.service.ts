import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JobsService } from './jobs.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface CatalogEntry {
  season: number;
  episode: number;
  url: string;
}

@Injectable()
export class CatalogScanner implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    console.error(
      '[CATALOG] scanner carregado — escaneamento sob demanda via SCAN_CATALOG job',
    );
  }

  /**
   * Escaneia um anime específico no meusanimes.blog e retorna todas as temporadas+episódios.
   */
  async scanAnime(animeSlug: string): Promise<CatalogEntry[]> {
    const url = `https://meusanimes.blog/a/${animeSlug}/`;
    console.error(`[CATALOG] scanning ${url}`);

    let html: string;
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'pt-BR,pt;q=0.9',
        },
        redirect: 'follow',
      });
      if (!res.ok) {
        console.error(`[CATALOG] ${url} retornou ${res.status}`);
        return [];
      }
      html = await res.text();
    } catch (err) {
      console.error(
        `[CATALOG] fetch falhou p/ ${url}:`,
        err instanceof Error ? err.message : String(err),
      );
      return [];
    }

    const entries = this.parseCatalog(html, animeSlug);
    console.error(
      `[CATALOG] ${animeSlug}: ${entries.length} episódios encontrados (${new Set(entries.map((e) => e.season)).size} temporadas)`,
    );
    return entries;
  }

  /**
   * Escaneia todos os animes FINALIZADO/EM_LANCAMENTO com episodeCount > episódios no DB.
   * Enfileira SCAN_CATALOG como job único, evitando execução em loop.
   */
  async scanAll(): Promise<{ scanned: number; enqueued: number }> {
    const animes = await this.prisma.anime.findMany({
      where: {
        status: { in: ['FINALIZADO', 'LANCAMENTO'] },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        episodeCount: true,
        _count: {
          select: { episodes: true },
        },
      },
    });

    let scanned = 0;
    let enqueued = 0;

    for (const anime of animes) {
      const dbEpisodeCount = anime._count.episodes;
      const expected = anime.episodeCount ?? 0;

      if (expected > 0 && dbEpisodeCount >= expected) {
        continue; // já tem todos os episódios esperados
      }

      scanned++;
      await this.jobs.enqueue({
        type: JOB_TYPE.SCAN_CATALOG,
        dedupeKey: `scan-catalog:${anime.id}`,
        payload: { animeId: anime.id, slug: anime.slug },
        priority: PRIORITY.SCAN_CATALOG,
      });
      enqueued++;
    }

    console.error(
      `[CATALOG] scanAll: ${scanned} animes com gap, ${enqueued} jobs enfileirados`,
    );
    return { scanned, enqueued };
  }

  /**
   * Processa um job SCAN_CATALOG: escaneia o anime, compara com o DB e enfileira
   * EXTRACT_EPISODE para episódios faltantes.
   */
  async processScanCatalog(
    animeId: string,
    slug: string,
  ): Promise<{ found: number; missing: number }> {
    const entries = await this.scanAnime(slug);
    if (entries.length === 0) return { found: 0, missing: 0 };

    const existing = await this.prisma.episode.findMany({
      where: { animeId },
      select: { number: true },
    });
    const haveSet = new Set(existing.map((e) => e.number));

    const offsetBySeason = new Map<number, number>();
    let prevSeason = -1;
    let prevMaxEp = 0;
    for (const entry of entries) {
      if (entry.season !== prevSeason) {
        offsetBySeason.set(entry.season, prevMaxEp);
        prevSeason = entry.season;
      }
      prevMaxEp = Math.max(
        prevMaxEp,
        offsetBySeason.get(entry.season)! + entry.episode,
      );
    }

    let missing = 0;
    for (const entry of entries) {
      const sequentialNumber =
        offsetBySeason.get(entry.season)! + entry.episode;
      if (haveSet.has(sequentialNumber)) continue;
      missing++;
      await this.jobs.enqueue({
        type: JOB_TYPE.EXTRACT_EPISODE,
        dedupeKey: `extract:${animeId}:s${entry.season}:${entry.episode}`,
        payload: {
          animeId,
          slug,
          episodeNumber: sequentialNumber,
          season: entry.season,
        },
        priority: PRIORITY.EXTRACT,
      });
    }

    console.error(
      `[CATALOG] ${slug}: ${entries.length} encontrados, ${missing} faltantes enfileirados`,
    );
    return { found: entries.length, missing };
  }

  /**
   * Parseia o HTML da página de catálogo do meusanimes.
   *
   * Estrutura esperada:
   * - div.numerando contém "S - E" (temporada - episódio)
   * - href="https://meusanimes.blog/e/{slug}-{season}-episodio-{ep}/"
   */
  private parseCatalog(html: string, slug: string): CatalogEntry[] {
    const entries: CatalogEntry[] = [];
    const seen = new Set<string>();

    const numerandoRe =
      /<div\s+class=['"]numerando['"]>\s*(\d+)\s*-\s*(\d+)\s*<\/div>/gi;
    let match: RegExpExecArray | null;
    while ((match = numerandoRe.exec(html)) !== null) {
      const season = parseInt(match[1] ?? '0', 10);
      const episode = parseInt(match[2] ?? '0', 10);
      if (Number.isFinite(season) && Number.isFinite(episode)) {
        const key = `${season}-${episode}`;
        if (!seen.has(key)) {
          seen.add(key);
          entries.push({
            season,
            episode,
            url: `https://meusanimes.blog/e/${slug}-${season}-episodio-${episode}/`,
          });
        }
      }
    }

    entries.sort((a, b) => {
      const cmp = a.season - b.season;
      return cmp !== 0 ? cmp : a.episode - b.episode;
    });

    return entries;
  }
}
