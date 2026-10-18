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
import { JobsService, WatchtowerJobRow } from './jobs.service';
import { EpisodeResolution } from './episode-resolution.service';
import { ReleaseMonitor } from './release-monitor.service';
import { SeasonDiscovery } from './season-discovery.service';
import { RepairWorker } from './repair-worker.service';
import { CatalogScanner } from './catalog-scanner.service';
import {
  ScheduleSync,
  SyncSchedulesPayload,
  SYNC_PAGE_DELAY_MS,
} from './schedule-sync.service';
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
  rustFallbackUrl?: string;
  rustFallbackSourceId?: string;
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
    private readonly episodes: EpisodeResolution,
    private readonly release: ReleaseMonitor,
    private readonly season: SeasonDiscovery,
    private readonly repair: RepairWorker,
    private readonly catalog: CatalogScanner,
    private readonly schedule: ScheduleSync,
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
        case JOB_TYPE.BACKFILL_ANILIST:
          await this.handleBackfillAnilist(job);
          return;
        case JOB_TYPE.SYNC_SCHEDULES:
          await this.handleSyncSchedules(job);
          return;
        case JOB_TYPE.GAP_CHECK:
          await this.handleGapCheck();
          break;
        default:
          throw new Error(`Tipo de job desconhecido: ${job.type}`);
      }
      await this.jobs.complete(job.id, job.lockedBy ?? '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.jobs.fail(job.id, job.lockedBy ?? '', msg);
    }
  }

  /**
   * SyncSchedules pode continuar: se a página não termina o catálogo
   * elegível, resschedule o MESMO job (lockedBy) com cursor novo e delay
   * — sem criar nova row, sem clobberar o lock de outra instância.
   */
  private async handleSyncSchedules(job: WatchtowerJobRow): Promise<void> {
    const payload = (job.payload ?? {}) as SyncSchedulesPayload;
    try {
      const result = await this.schedule.syncSchedules(payload);
      if (result.continued && result.nextAfterId) {
        const nextRunAt = new Date(Date.now() + SYNC_PAGE_DELAY_MS);
        const rescheduled = await this.jobs.reschedule(
          job.id,
          job.lockedBy ?? '',
          { afterId: result.nextAfterId },
          nextRunAt,
        );
        if (!rescheduled) {
          // Lock perdido (stale reap) — não clobber. Falha p/ backoff+retry.
          throw new Error(
            `reschedule falhou: lock ${job.lockedBy ?? '(none)'} não pertence mais a este worker`,
          );
        }
        return;
      }
      await this.jobs.complete(job.id, job.lockedBy ?? '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.jobs.fail(job.id, job.lockedBy ?? '', msg);
      throw err;
    }
  }

  private async handleBackfillAnilist(job: WatchtowerJobRow): Promise<void> {
    const payload = (job.payload ?? {}) as { afterId?: string };
    const result = await this.schedule.backfillAnilistPage(payload.afterId);
    if (!result.nextAfterId) {
      await this.jobs.complete(job.id, job.lockedBy ?? '');
      return;
    }
    const rescheduled = await this.jobs.reschedule(
      job.id,
      job.lockedBy ?? '',
      { afterId: result.nextAfterId },
      new Date(Date.now() + SYNC_PAGE_DELAY_MS),
    );
    if (!rescheduled) {
      throw new Error(
        `reschedule do backfill falhou: lock ${job.lockedBy ?? '(none)'} não pertence mais a este worker`,
      );
    }
  }

  private async handleExtract(p: ExtractPayload): Promise<void> {
    await this.episodes.resolveAndPublish({
      animeId: p.animeId,
      slug: p.slug,
      episodeNumber: p.episodeNumber,
      season: p.season ?? 1,
      episodeUrl: p.episodeUrl,
      mode: 'extract',
    });
  }

  private async handleRepair(p: RepairPayload): Promise<void> {
    await this.episodes.resolveAndPublish({
      animeId: p.animeId,
      episodeNumber: p.episodeNumber,
      season: p.season ?? 1,
      rustFallbackUrl: p.rustFallbackUrl,
      rustFallbackSourceId: p.rustFallbackSourceId,
      mode: 'repair',
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
          number - LAG(number) OVER (PARTITION BY "animeId", "season" ORDER BY number) AS gap_size
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

    const enqueueInputs: Array<{
      type: string;
      dedupeKey: string;
      payload: { animeId: string; slug: string };
      priority: number;
    }> = [];
    for (const gap of gaps) {
      enqueueInputs.push({
        type: JOB_TYPE.SCAN_CATALOG,
        dedupeKey: `scan-catalog:${gap.animeId}`,
        payload: { animeId: gap.animeId, slug: gap.slug },
        priority: PRIORITY.SCAN_CATALOG,
      });
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
      enqueueInputs.push({
        type: JOB_TYPE.SCAN_CATALOG,
        dedupeKey: `scan-catalog:${anime.id}`,
        payload: { animeId: anime.id, slug: anime.slug },
        priority: PRIORITY.SCAN_CATALOG,
      });
    }

    // Batch insert: uma única ida ao PostgreSQL para todos os jobs.
    // Dedup por dedupeKey: mesmo anime pode aparecer em gaps E incompleto.
    const seen = new Map<string, (typeof enqueueInputs)[number]>();
    for (const input of enqueueInputs) {
      const prev = seen.get(input.dedupeKey);
      if (!prev || input.priority < prev.priority)
        seen.set(input.dedupeKey, input);
    }
    await this.jobs.enqueueMany([...seen.values()]);

    console.error(
      `[GAP_CHECK] ${gaps.length} animes com gaps, ${incomplete.filter((a) => a._count.episodes < (a.episodeCount ?? 0)).length} incompletos, ${enqueueInputs.length} jobs enfileirados`,
    );
  }
}
