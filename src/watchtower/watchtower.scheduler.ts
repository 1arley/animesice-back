/**
 * WatchtowerScheduler — dispatcher de cron do NestJS.
 *
 *Ticks:
 *  - a cada 1 min: processa batch de jobs devidos (cap env WT_TICK_BATCH=20),
 *    cada job com timeout rígido (env WT_JOB_TIMEOUT_MS=180000) p/ um scrape
 *    travado nunca congelar a fila
 *  - a cada 15 min: enfileira CHECK_RELEASES + reapStale
 *  - a cada 6h: enfileira GAP_CHECK (detecta gaps de episódios e enfileira SCAN_CATALOG)
 *  - 1x/dia (03:00): DISCOVER_SEASON + repair sweep + canário revive + scanAll (gaps only)
 *
 * Guarda se WATCHTOWER_ENABLED != 'true' — feature flag total.
 * Sub-flags: WT_SEASON_DISCOVERY_ENABLED, WT_REPAIR_ENABLED.
 *
 * NOTA: scanAll roda SEM force — o force=true varre o catálogo INTEIRO e
 * afoga a fila com milhares de EXTRACT_EPISODE (backfill), faminto o
 * CHECK_RELEASES (episódios novos).
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { JobsService, WatchtowerJobRow } from './jobs.service';
import { WorkerService } from './worker.service';
import { RepairWorker } from './repair-worker.service';
import { HealthMonitor } from './health-monitor.service';
import { CatalogScanner } from './catalog-scanner.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

const TICK_BATCH = Number(process.env.WT_TICK_BATCH ?? 20);
const STALE_MS = 10 * 60_000;
/** Timeout rígido por job de extração/varredura: um scrape travado (ex:
 * resolução de player via chromium) não pode congelar a fila inteira. O job
 * fica RUNNING e é reapado pelo reapStale com backoff; maxAttempts o converte
 * em DEAD.
 */
const JOB_TIMEOUT_MS = Number(process.env.WT_JOB_TIMEOUT_MS ?? 180_000);
/** Timeout folgado p/ jobs de controle: checkAll varre TODOS os animes em
 * lançamento via AniList e legitmamente leva >3min (observado ~3.5min em prod).
 */
const CONTROL_TIMEOUT_MS = Number(
  process.env.WT_CONTROL_TIMEOUT_MS ?? 15 * 60_000,
);
/** Jobs de controle (raros, sem risco de hang de chromium) — timeout generoso. */
const CONTROL_JOB_TYPES = new Set<string>([
  JOB_TYPE.CHECK_RELEASES,
  JOB_TYPE.DISCOVER_SEASON,
  JOB_TYPE.SYNC_AIRING,
  JOB_TYPE.GAP_CHECK,
  JOB_TYPE.BACKFILL_ANILIST,
  JOB_TYPE.SYNC_SCHEDULES,
]);

@Injectable()
export class WatchtowerScheduler implements OnModuleInit {
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly worker: WorkerService,
    private readonly repair: RepairWorker,
    private readonly health: HealthMonitor,
    private readonly catalog: CatalogScanner,
  ) {}

  onModuleInit(): void {
    if (this.enabled()) {
      console.error('[WATCHTOWER] iniciado — tick batch=' + TICK_BATCH);
    } else {
      console.error('[WATCHTOWER] desabilitado (WATCHTOWER_ENABLED!=true)');
    }
  }

  private enabled(): boolean {
    return process.env.WATCHTOWER_ENABLED === 'true';
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.enabled() || this.running) return;
    this.running = true;
    try {
      const batch = await this.jobs.claimBatch(TICK_BATCH);
      for (const job of batch) {
        await this.processWithTimeout(job);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Processa um job com timeout rígido. Se estourar, loga e segue p/ o
   * próximo — a promise original continua em background e, ao terminar,
   * completa/falha o job via guards de lockedBy (sem clobber). Garante que
   * um único job travado nunca congele o pipeline inteiro.
   */
  private async processWithTimeout(job: WatchtowerJobRow): Promise<void> {
    const timeoutMs = CONTROL_JOB_TYPES.has(job.type)
      ? CONTROL_TIMEOUT_MS
      : JOB_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const proc = this.worker.process(job).catch((e) => {
        console.error(
          '[WATCHTOWER] job falhou fora do tick:',
          job.type,
          e instanceof Error ? e.message : String(e),
        );
      });
      await Promise.race([
        proc,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`job ${job.type} excedeu ${timeoutMs}ms (pulado)`),
              ),
            timeoutMs,
          );
        }),
      ]);
    } catch (err) {
      console.error(
        '[WATCHTOWER] tick skip (timeout):',
        job.type,
        job.id,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  @Cron('0 */15 * * * *')
  async scheduleReleases(): Promise<void> {
    if (!this.enabled()) return;
    await this.jobs.reapStale(STALE_MS);
    await this.jobs.enqueue({
      type: JOB_TYPE.CHECK_RELEASES,
      dedupeKey: 'check-releases',
      payload: {},
      priority: PRIORITY.CHECK_RELEASES,
    });
  }

  /**
   * A cada 6h: detecta animes com gaps nos episódios (ex: One Piece 110→1037)
   * e enfileira SCAN_CATALOG force para repará-los.
   */
  @Cron('0 */6 * * *')
  async gapCheck(): Promise<void> {
    if (!this.enabled()) return;
    await this.jobs.enqueue({
      type: JOB_TYPE.GAP_CHECK,
      dedupeKey: 'gap-check',
      payload: {},
      priority: PRIORITY.GAP_CHECK,
    });
  }

  @Cron('0 3 * * *')
  async dailyTasks(): Promise<void> {
    if (!this.enabled()) return;
    await this.health.reviveOne().catch(() => undefined);
    if (process.env.WT_REPAIR_ENABLED !== 'false') {
      await this.repair.sweep().catch((e) => {
        console.error(
          '[WATCHTOWER] repair sweep falhou:',
          e instanceof Error ? e.message : String(e),
        );
      });
    }
    if (process.env.WT_SEASON_DISCOVERY_ENABLED !== 'false') {
      await this.jobs.enqueue({
        type: JOB_TYPE.DISCOVER_SEASON,
        dedupeKey: 'discover-season',
        payload: {},
        priority: PRIORITY.DISCOVER_SEASON,
      });
      await this.catalog.scanAll(false).catch((e) => {
        console.error(
          '[WATCHTOWER] scanAll falhou:',
          e instanceof Error ? e.message : String(e),
        );
      });
    }
    // Backfill de metadados (anilistId/season/year) + horários fixos (AnimeSchedule).
    // O backfill auto-enfileira continua até zerar; o sync de horários é
    // idempotente e atualiza o calendário semanal.
    // OPT-IN: só rodam com WT_BACKFILL_ENABLED=true / WT_SCHEDULE_SYNC_ENABLED=true.
    // O matcher de título é heurístico — nunca rodar sobre o catálogo inteiro
    // sem supervisão (falsa positivos poluem anilistId/year/season/studios).
    if (process.env.WT_BACKFILL_ENABLED === 'true') {
      await this.jobs.enqueue({
        type: JOB_TYPE.BACKFILL_ANILIST,
        dedupeKey: 'backfill-anilist',
        payload: {},
        priority: PRIORITY.BACKFILL_ANILIST,
      });
    }
    if (process.env.WT_SCHEDULE_SYNC_ENABLED === 'true') {
      await this.jobs.enqueue({
        type: JOB_TYPE.SYNC_SCHEDULES,
        dedupeKey: 'sync-schedules',
        payload: {},
        priority: PRIORITY.SYNC_SCHEDULES,
      });
    }
  }
}
