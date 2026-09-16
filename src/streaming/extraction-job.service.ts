import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';

export type ExtractionJobStatus =
  'pending' | 'processing' | 'completed' | 'failed';
export interface ExtractionJob {
  id: string;
  animeSlug: string;
  episodeNumber: number;
  season: number;
  status: ExtractionJobStatus;
  result: { videoUrl: string | null; playerEmbed: string | null } | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}
type ExtractionFn = () => Promise<{
  videoUrl: string | null;
  playerEmbed: string | null;
}>;
type Listener = (job: ExtractionJob) => void;
const TTL_MS = 5 * 60_000;

@Injectable()
export class ExtractionJobService implements OnModuleDestroy {
  private readonly workerId = crypto.randomUUID();
  private readonly listeners = new Map<string, Set<Listener>>();
  private pollTimer?: ReturnType<typeof setTimeout>;

  onModuleDestroy(): void {
    clearTimeout(this.pollTimer);
    this.listeners.clear();
  }

  // ponytail: DB poll a cada 1s enquanto houver listeners pendentes entrega o
  // finish de jobs concluídos em outra réplica; custo = 1 find/job/s.
  // Upgrade: Redis pub/sub na finalização se o volume justificar.
  private schedulePoll(): void {
    if (this.pollTimer || !this.listeners.size) return;
    this.pollTimer = setTimeout(() => {
      void (async () => {
        try {
          for (const id of this.listeners.keys()) {
            const job = await this.getJob(id);
            if (job) this.notify(job);
          }
        } catch {
          return;
        } finally {
          this.pollTimer = undefined;
          this.schedulePoll();
        }
      })();
    }, 1_000);
    this.pollTimer.unref();
  }

  private notify(job: ExtractionJob): void {
    if (job.status !== 'completed' && job.status !== 'failed') return;
    const listeners = this.listeners.get(job.id);
    this.listeners.delete(job.id);
    if (!this.listeners.size) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const listener of listeners ?? []) {
      try {
        listener(job);
      } catch {
        continue;
      }
    }
  }
  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanup(): Promise<void> {
    await this.prisma.streamExtractionJob.deleteMany({
      where: { completedAt: { lt: new Date(Date.now() - TTL_MS) } },
    });
  }
  async getJob(id: string): Promise<ExtractionJob | undefined> {
    const job = await this.prisma.streamExtractionJob.findUnique({
      where: { id },
    });
    return job ? this.toJob(job) : undefined;
  }
  async onComplete(id: string, listener: Listener): Promise<() => void> {
    const listeners = this.listeners.get(id) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    const unsubscribe = () => {
      listeners.delete(listener);
      if (!listeners.size && this.listeners.get(id) === listeners) {
        this.listeners.delete(id);
      }
      if (!this.listeners.size) {
        clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
      }
    };
    try {
      const job = await this.getJob(id);
      if (job) this.notify(job);
      this.schedulePoll();
      return unsubscribe;
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }
  async findByEpisode(
    animeSlug: string,
    episodeNumber: number,
    season: number,
  ): Promise<ExtractionJob | undefined> {
    const job = await this.prisma.streamExtractionJob.findFirst({
      where: {
        animeSlug,
        episodeNumber,
        season,
        status: { in: ['pending', 'processing'] },
      },
    });
    return job ? this.toJob(job) : undefined;
  }
  async submit(
    animeSlug: string,
    episodeNumber: number,
    season: number,
    fn: ExtractionFn,
  ): Promise<ExtractionJob> {
    const activeKey = `${animeSlug}:s${season}:ep${episodeNumber}`;
    let job = await this.findByEpisode(animeSlug, episodeNumber, season);
    if (!job) {
      try {
        job = this.toJob(
          await this.prisma.streamExtractionJob.create({
            data: { activeKey, animeSlug, episodeNumber, season },
          }),
        );
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        job = await this.findByEpisode(animeSlug, episodeNumber, season);
        if (!job) throw error;
      }
    }
    void this.start(job, fn).catch(() => undefined);
    return job;
  }
  private async start(job: ExtractionJob, fn: ExtractionFn): Promise<void> {
    const claim = await this.prisma.streamExtractionJob.updateMany({
      where: {
        id: job.id,
        OR: [
          { status: 'pending' },
          { status: 'processing', lockedUntil: { lt: new Date() } },
        ],
      },
      data: {
        status: 'processing',
        lockedBy: this.workerId,
        lockedUntil: new Date(Date.now() + TTL_MS),
      },
    });
    if (!claim.count) return;
    try {
      await this.finish(job.id, 'completed', await fn(), null);
    } catch (error) {
      await this.finish(
        job.id,
        'failed',
        null,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private async finish(
    id: string,
    status: 'completed' | 'failed',
    result: ExtractionJob['result'],
    error: string | null,
  ): Promise<void> {
    const updated = await this.prisma.streamExtractionJob.updateMany({
      where: { id, status: 'processing', lockedBy: this.workerId },
      data: {
        activeKey: null,
        status,
        videoUrl: result?.videoUrl ?? null,
        playerEmbed: result?.playerEmbed ?? null,
        error,
        lockedBy: null,
        lockedUntil: null,
        completedAt: new Date(),
      },
    });
    if (!updated.count) return;
    const job = await this.getJob(id);
    if (job) this.notify(job);
  }
  private toJob(job: {
    id: string;
    animeSlug: string;
    episodeNumber: number;
    season: number;
    status: string;
    videoUrl: string | null;
    playerEmbed: string | null;
    error: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }): ExtractionJob {
    return {
      id: job.id,
      animeSlug: job.animeSlug,
      episodeNumber: job.episodeNumber,
      season: job.season,
      status: job.status as ExtractionJobStatus,
      result:
        job.videoUrl || job.playerEmbed
          ? { videoUrl: job.videoUrl, playerEmbed: job.playerEmbed }
          : null,
      error: job.error,
      createdAt: job.createdAt.getTime(),
      completedAt: job.completedAt?.getTime() ?? null,
    };
  }
}
