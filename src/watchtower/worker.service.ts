/**
 * WorkerService — processa jobs claimados da fila, despachando por type.
 *
 * EXTRACT_EPISODE: extrai -> valida -> publica. Se falha em todas as fontes:
 * marca videoBroken no episódio (se existe) e reenfileira via backoff.
 * REPAIR_EPISODE: igual a EXTRACT mas p/ episódio existente com vídeo morto.
 * CHECK_RELEASES: delega p/ ReleaseMonitor (enfileira EXTRAÇÕES).
 * DISCOVER_SEASON: delega p/ SeasonDiscovery.
 * SYNC_AIRING: delega p/ ReleaseMonitor.checkAll.
 * GAP_CHECK: detecta animes com gaps nos episódios (ex: One Piece 110→1037)
 *   e enfileira SCAN_CATALOG force para repará-los.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { probeMediaUrlDead } from '@/common/media-probe';
import { JobsService, WatchtowerJobRow } from './jobs.service';
import { Extractor } from './extractor.service';
import { Validator } from './validator.service';
import { Publisher } from './publisher.service';
import { ReleaseMonitor } from './release-monitor.service';
import { SeasonDiscovery } from './season-discovery.service';
import { RepairWorker } from './repair-worker.service';
import { HealthMonitor } from './health-monitor.service';
import { CatalogScanner } from './catalog-scanner.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

interface ExtractPayload {
  animeId: string;
  slug: string;
  episodeNumber: number;
  season?: number;
  /** URL real do episódio vinda do catálogo (evita divergência de template). */
  episodeUrl?: string;
}

interface RepairPayload {
  animeId: string;
  episodeNumber: number;
  season?: number;
}

interface ScanCatalogPayload {
  animeId?: string;
  slug?: string;
}

@Injectable()
export class WorkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly extractor: Extractor,
    private readonly validator: Validator,
    private readonly publisher: Publisher,
    private readonly release: ReleaseMonitor,
    private readonly season: SeasonDiscovery,
    private readonly repair: RepairWorker,
    private readonly health: HealthMonitor,
    private readonly catalog: CatalogScanner,
  ) {}

  async process(job: WatchtowerJobRow): Promise<void> {
    try {
      switch (job.type) {
        case JOB_TYPE.EXTRACT_EPISODE:
          await this.handleExtract(job.payload as ExtractPayload);
          break;
        case JOB_TYPE.REPAIR_EPISODE:
          await this.handleRepair(job.payload as RepairPayload);
          break;
        case JOB_TYPE.CHECK_RELEASES:
          await this.release.checkAll();
          break;
        case JOB_TYPE.DISCOVER_SEASON:
          await this.season.discover();
          break;
        case JOB_TYPE.SCAN_CATALOG: {
          const p = (job.payload ?? {}) as ScanCatalogPayload;
          if (p.animeId && p.slug) {
            await this.catalog.processScanCatalog(p.animeId, p.slug);
          } else {
            await this.catalog.scanAll();
          }
          break;
        }
        case JOB_TYPE.SYNC_AIRING:
          await this.release.checkAll();
          break;
        case JOB_TYPE.GAP_CHECK:
          await this.handleGapCheck();
          break;
        default:
          throw new Error(`Tipo de job desconhecido: ${job.type}`);
      }
      await this.jobs.complete(job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.jobs.fail(job.id, msg);
    }
  }

  private async handleExtract(p: ExtractPayload): Promise<void> {
    const anime = await this.prisma.anime.findUnique({
      where: { id: p.animeId },
      select: { id: true, slug: true, coverImage: true },
    });
    if (!anime) throw new Error(`Anime ${p.animeId} não encontrado`);

    const season = p.season ?? 1;
    const { candidates } = await this.extractor.extract(
      anime.slug,
      p.episodeNumber,
      season,
      p.episodeUrl,
    );
    if (candidates.length === 0) {
      throw new Error(
        `Nenhuma fonte resolveu ${anime.slug}/s${season}/${p.episodeNumber}`,
      );
    }

    const valid = await this.validator.pickValid(candidates, anime.id);
    if (!valid) {
      for (const c of candidates) await this.health.recordFailure(c.sourceId);
      throw new Error(
        `Validação falhou p/ ${anime.slug}/s${season}/${p.episodeNumber} (vídeos mortos)`,
      );
    }

    const embedUrl =
      valid.embedUrl ??
      this.embedUrlForSource(
        valid.sourceId,
        anime.slug,
        p.episodeNumber,
        season,
      );
    await this.publisher.publish({
      animeId: anime.id,
      episodeNumber: p.episodeNumber,
      season,
      videoUrl: valid.videoUrl,
      embedUrl,
      sourceId: valid.sourceId,
      thumbnailUrl: valid.thumbnailUrl ?? anime.coverImage,
      title: valid.title ?? `Episódio ${p.episodeNumber}`,
      duration: valid.duration,
    });
  }

  private async handleRepair(p: RepairPayload): Promise<void> {
    const season = p.season ?? 1;
    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: p.animeId,
          season,
          number: p.episodeNumber,
        },
      },
      select: { id: true, animeId: true, number: true },
    });
    if (!episode) {
      await this.handleExtract({
        animeId: p.animeId,
        slug:
          (
            await this.prisma.anime.findUnique({
              where: { id: p.animeId },
              select: { slug: true },
            })
          )?.slug ?? '',
        episodeNumber: p.episodeNumber,
      });
      return;
    }

    const anime = await this.prisma.anime.findUnique({
      where: { id: p.animeId },
      select: { id: true, slug: true, coverImage: true },
    });
    if (!anime) throw new Error(`Anime ${p.animeId} não encontrado`);

    // Probe p/ confirmar que realmente está morto antes de re-extrair
    const current = await this.prisma.episode.findUnique({
      where: { id: episode.id },
      select: { videoUrl: true },
    });
    if (current?.videoUrl) {
      const dead = await probeMediaUrlDead(current.videoUrl);
      if (!dead) {
        await this.prisma.episode.update({
          where: { id: episode.id },
          data: { videoBroken: false, videoCheckedAt: new Date() },
        });
        return;
      }
    }

    await this.prisma.episode
      .update({
        where: { id: episode.id },
        data: { videoBroken: true },
      })
      .catch(() => undefined);

    const { candidates } = await this.extractor.extract(
      anime.slug,
      p.episodeNumber,
      p.season ?? 1,
    );
    if (candidates.length === 0)
      throw new Error(`Repair: sem fonte p/ ${anime.slug}/${p.episodeNumber}`);

    const valid = await this.validator.pickValid(candidates, anime.id);
    if (!valid)
      throw new Error(
        `Repair: validação falhou ${anime.slug}/${p.episodeNumber}`,
      );

    const embedUrl =
      valid.embedUrl ??
      this.embedUrlForSource(
        valid.sourceId,
        anime.slug,
        p.episodeNumber,
        p.season ?? 1,
      );
    await this.publisher.publish({
      animeId: anime.id,
      episodeNumber: p.episodeNumber,
      season: p.season ?? 1,
      videoUrl: valid.videoUrl,
      embedUrl,
      sourceId: valid.sourceId,
      thumbnailUrl: valid.thumbnailUrl ?? anime.coverImage,
      title: `Episódio ${p.episodeNumber}`,
    });
  }

  /**
   * GAP_CHECK: detecta animes com gaps nos episódios (ex: One Piece 110→1037)
   * e enfileira SCAN_CATALOG para repará-los. Um gap é quando há um salto de
   * mais de 2 no number entre episódios consecutivos do mesmo anime.
   * Também detecta animes com episodeCount > count real de episódios.
   */
  private async handleGapCheck(): Promise<void> {
    // 1. Detecta gaps via query SQL (window function)
    const gaps = await this.prisma.$queryRaw<
      Array<{ animeId: string; slug: string; gapCount: bigint }>
    >`
      WITH ep_gaps AS (
        SELECT
          "animeId",
          number,
          number - LAG(number) OVER (PARTITION BY "animeId" ORDER BY number) AS gap_size
        FROM "Episode"
      )
      SELECT
        g."animeId",
        a.slug,
        COUNT(*)::bigint AS gap_count
      FROM ep_gaps g
      JOIN "Anime" a ON a.id = g."animeId"
      WHERE g.gap_size > 2
      GROUP BY g."animeId", a.slug
    `;

    let enqueued = 0;
    for (const gap of gaps) {
      await this.jobs.enqueue({
        type: JOB_TYPE.SCAN_CATALOG,
        dedupeKey: `scan-catalog:${gap.animeId}`,
        payload: { animeId: gap.animeId, slug: gap.slug },
        priority: PRIORITY.GAP_CHECK,
      });
      enqueued++;
    }

    // 2. Detecta animes com episodeCount > count real de eps
    const incomplete = await this.prisma.anime.findMany({
      where: {
        episodeCount: { gt: 0 },
        status: { in: ['FINALIZADO', 'LANCAMENTO'] },
      },
      select: {
        id: true,
        slug: true,
        episodeCount: true,
        _count: { select: { episodes: true } },
      },
    });

    for (const anime of incomplete) {
      if (anime._count.episodes >= (anime.episodeCount ?? 0)) continue;
      await this.jobs.enqueue({
        type: JOB_TYPE.SCAN_CATALOG,
        dedupeKey: `scan-catalog:${anime.id}`,
        payload: { animeId: anime.id, slug: anime.slug },
        priority: PRIORITY.GAP_CHECK,
      });
      enqueued++;
    }

    console.error(
      `[GAP_CHECK] ${gaps.length} animes com gaps, ${incomplete.filter((a) => a._count.episodes < (a.episodeCount ?? 0)).length} incompletos, ${enqueued} jobs enfileirados`,
    );
  }

  private embedUrlForSource(
    sourceId: string,
    slug: string,
    ep: number,
    _season: number = 1,
  ): string {
    switch (sourceId) {
      case 'meusanimes':
        return `https://meusanimes.blog/e/${slug}-episodio-${ep}/`;
      case 'animefire':
        return `https://animefire.io/animes/${slug}/${ep}`;
      case 'animesonlinecc':
        return `https://animesonlinecc.to/episodio/${slug}-episodio-${ep}/`;
      default:
        return '';
    }
  }
}
