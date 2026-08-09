/**
 * JobsService — fila de jobs no Postgres com claim atômico e backoff.
 *
 * Claim: UPDATE ... SET status=RUNNING, lockedBy, lockedAt WHERE id = ? AND
 * status = PENDING RETURNING *. Evita race entre múltiplas instâncias (embora
 * seja singleton, protege contra restarts/overlap de cron).
 *
 * Backoff exponencial em nextRunAt; DEAD após maxAttempts.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

interface EnqueueInput {
  type: string;
  dedupeKey: string;
  payload: unknown;
  priority?: number;
  maxAttempts?: number;
}

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: EnqueueInput): Promise<void> {
    const nextRunAt = new Date();
    try {
      await this.prisma.watchtowerJob.upsert({
        where: {
          type_dedupeKey: { type: input.type, dedupeKey: input.dedupeKey },
        },
        update: {},
        create: {
          type: input.type,
          dedupeKey: input.dedupeKey,
          payload: input.payload as object,
          priority: input.priority ?? 100,
          maxAttempts: input.maxAttempts ?? 5,
          nextRunAt,
        },
      });
    } catch {
      // dedupe race — ignora
    }
  }

  /** Claim N jobs devidos (status=PENDING, nextRunAt<=agora), mais urgentes 1º. */
  async claimBatch(limit: number): Promise<WatchtowerJobRow[]> {
    const candidates = await this.prisma.watchtowerJob.findMany({
      where: {
        status: 'PENDING',
        nextRunAt: { lte: new Date() },
      },
      orderBy: [{ priority: 'asc' }, { nextRunAt: 'asc' }],
      take: limit,
    });

    const claimed: WatchtowerJobRow[] = [];
    const lockId = crypto.randomUUID();
    for (const job of candidates) {
      try {
        const updated = await this.prisma.watchtowerJob.update({
          where: { id: job.id, status: 'PENDING' },
          data: {
            status: 'RUNNING',
            lockedBy: lockId,
            lockedAt: new Date(),
          },
        });
        claimed.push(updated);
      } catch {
        // já foi claimado por outra instância — skip
      }
    }
    return claimed;
  }

  /** Marca job como DONE, limpa lock. */
  async complete(id: string): Promise<void> {
    await this.prisma.watchtowerJob.update({
      where: { id },
      data: { status: 'DONE', lockedBy: null, lockedAt: null, lastError: null },
    });
  }

  /** Marca falha: reenfileira com backoff ou marca DEAD se esgotou tentativas. */
  async fail(id: string, error: string): Promise<void> {
    const job = await this.prisma.watchtowerJob.findUnique({
      where: { id },
      select: { attempts: true, maxAttempts: true },
    });
    if (!job) return;

    const newAttempts = job.attempts + 1;
    const isDead = newAttempts >= job.maxAttempts;
    const backoff = this.backoffMs(job.attempts);

    await this.prisma.watchtowerJob.update({
      where: { id },
      data: {
        status: isDead ? 'DEAD' : 'PENDING',
        attempts: newAttempts,
        lastError: error.slice(0, 2000),
        nextRunAt: isDead ? undefined : new Date(Date.now() + backoff),
        lockedBy: null,
        lockedAt: null,
      },
    });
  }

  /** Estatísticas da fila (p/ admin/status). */
  async stats(): Promise<Record<string, number>> {
    const rows = await this.prisma.watchtowerJob.groupBy({
      by: ['status'],
      _count: true,
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r._count;
    return out;
  }

  /** Reset de jobs RUNNING presos (crash/restart). Retorna p/ PENDING. */
  async reapStale(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const r = await this.prisma.watchtowerJob.updateMany({
      where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
      data: { status: 'PENDING', lockedBy: null, lockedAt: null },
    });
    return r.count;
  }

  private backoffMs(attempts: number): number {
    const steps = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];
    return (
      steps[Math.min(attempts, steps.length - 1)] ?? steps[steps.length - 1]!
    );
  }
}

export interface WatchtowerJobRow {
  id: string;
  type: string;
  dedupeKey: string;
  payload: unknown;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
  lastError: string | null;
  lockedBy: string | null;
  lockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
