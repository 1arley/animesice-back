import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

export type ExtractionJobStatus =
  'pending' | 'processing' | 'completed' | 'failed';

export interface ExtractionJob {
  id: string;
  animeSlug: string;
  episodeNumber: number;
  season: number;
  status: ExtractionJobStatus;
  result: {
    videoUrl: string | null;
    playerEmbed: string | null;
  } | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

type ExtractionFn = () => Promise<{
  videoUrl: string | null;
  playerEmbed: string | null;
}>;

type JobCompletionListener = (job: ExtractionJob) => void;

const JOB_TTL_MS = 5 * 60_000;
const MAX_CONCURRENT_JOBS = parseInt(
  process.env.MAX_EXTRACTION_JOBS ?? '5',
  10,
);

@Injectable()
export class ExtractionJobService {
  private readonly jobs = new Map<string, ExtractionJob>();
  private activeJobs = 0;
  private readonly queue: Array<{
    job: ExtractionJob;
    fn: ExtractionFn;
    resolve: () => void;
  }> = [];
  private readonly completionListeners = new Map<
    string,
    Set<JobCompletionListener>
  >();

  @Cron(CronExpression.EVERY_MINUTE)
  cleanup(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
  }

  private generateId(
    animeSlug: string,
    episodeNumber: number,
    season: number,
  ): string {
    return `ext:${animeSlug}:s${season}:ep${episodeNumber}:${Date.now()}`;
  }

  getJob(id: string): ExtractionJob | undefined {
    return this.jobs.get(id);
  }

  /**
   * Registra um callback chamado quando o job completa (completed ou failed).
   * Se o job já está em estado terminal, chama imediatamente.
   * Retorna uma função de cleanup que remove o listener.
   */
  onComplete(jobId: string, listener: JobCompletionListener): () => void {
    const job = this.jobs.get(jobId);
    if (job && (job.status === 'completed' || job.status === 'failed')) {
      listener(job);
      return () => {};
    }
    let listeners = this.completionListeners.get(jobId);
    if (!listeners) {
      listeners = new Set();
      this.completionListeners.set(jobId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.completionListeners.delete(jobId);
    };
  }

  findByEpisode(
    animeSlug: string,
    episodeNumber: number,
    season: number,
  ): ExtractionJob | undefined {
    for (const [, job] of this.jobs) {
      if (
        job.animeSlug === animeSlug &&
        job.episodeNumber === episodeNumber &&
        job.season === season &&
        (job.status === 'pending' || job.status === 'processing')
      ) {
        return job;
      }
    }
    return undefined;
  }

  submit(
    animeSlug: string,
    episodeNumber: number,
    season: number,
    fn: ExtractionFn,
  ): ExtractionJob {
    const existing = this.findByEpisode(animeSlug, episodeNumber, season);
    if (existing) return existing;

    const id = this.generateId(animeSlug, episodeNumber, season);
    const job: ExtractionJob = {
      id,
      animeSlug,
      episodeNumber,
      season,
      status: 'pending',
      result: null,
      error: null,
      createdAt: Date.now(),
      completedAt: null,
    };
    this.jobs.set(id, job);

    void this.processNext(job, fn);
    return job;
  }

  private processNext(job: ExtractionJob, fn: ExtractionFn): void {
    if (this.activeJobs >= MAX_CONCURRENT_JOBS) {
      this.queue.push({ job, fn, resolve: () => {} });
      return;
    }
    void this.runJob(job, fn);
  }

  private async runJob(job: ExtractionJob, fn: ExtractionFn): Promise<void> {
    this.activeJobs++;
    job.status = 'processing';
    try {
      const result = await fn();
      job.result = result;
      job.status = 'completed';
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.completedAt = Date.now();
      this.activeJobs--;
      this.emitCompletion(job);
      this.drainQueue();
    }
  }

  private emitCompletion(job: ExtractionJob): void {
    const listeners = this.completionListeners.get(job.id);
    if (listeners && listeners.size > 0) {
      for (const listener of listeners) {
        try {
          listener(job);
        } catch {
          /* listener error doesn't break the loop */
        }
      }
      this.completionListeners.delete(job.id);
    }
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.activeJobs < MAX_CONCURRENT_JOBS) {
      const next = this.queue.shift()!;
      void this.runJob(next.job, next.fn);
    }
  }
}
