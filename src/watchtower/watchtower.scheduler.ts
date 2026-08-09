/**
 * WatchtowerScheduler — dispatcher de cron do NestJS.
 *
 *Ticks:
 *  - a cada 1 min: processa batch de jobs devidos (cap env WT_TICK_BATCH=5)
 *  - a cada 15 min: enfileira CHECK_RELEASES + reapStale
 *  - 1x/dia (03:00): DISCOVER_SEASON + repair sweep + canário revive
 *
 * Guarda se WATCHTOWER_ENABLED != 'true' — feature flag total.
 * Sub-flags: WT_SEASON_DISCOVERY_ENABLED, WT_REPAIR_ENABLED.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobsService } from './jobs.service';
import { WorkerService } from './worker.service';
import { RepairWorker } from './repair-worker.service';
import { HealthMonitor } from './health-monitor.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

const TICK_BATCH = Number(process.env.WT_TICK_BATCH ?? 5);
const STALE_MS = 10 * 60_000;

@Injectable()
export class WatchtowerScheduler implements OnModuleInit {
  private running = false;

  constructor(
    private readonly jobs: JobsService,
    private readonly worker: WorkerService,
    private readonly repair: RepairWorker,
    private readonly health: HealthMonitor,
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
        await this.worker.process(job).catch(() => undefined);
      }
    } finally {
      this.running = false;
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
    }
  }
}
