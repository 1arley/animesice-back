/**
 * JobsService — fila de jobs no Postgres com claim atômico e backoff.
 *
 * Claim: UPDATE ... SET status=RUNNING, lockedBy, lockedAt WHERE id = ? AND
 * status = PENDING RETURNING *. Evita race entre múltiplas instâncias (embora
 * seja singleton, protege contra restarts/overlap de cron).
 *
 * Backoff exponencial em nextRunAt; DEAD após maxAttempts.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { nextBackoffMs } from './watchtower.types';

interface EnqueueInput {
  type: string;
  dedupeKey: string;
  payload: unknown;
  priority?: number;
  maxAttempts?: number;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: EnqueueInput): Promise<void> {
    const nextRunAt = new Date();
    const existing = await this.prisma.watchtowerJob.findUnique({
      where: {
        type_dedupeKey: { type: input.type, dedupeKey: input.dedupeKey },
      },
      select: { id: true, status: true, priority: true },
    });

    if (existing) {
      if (existing.status === 'DONE' || existing.status === 'DEAD') {
        await this.prisma.watchtowerJob.update({
          where: { id: existing.id },
          data: {
            status: 'PENDING',
            nextRunAt,
            attempts: 0,
            lastError: null,
            lockedBy: null,
            lockedAt: null,
            payload: input.payload as object,
            priority: input.priority ?? 100,
          },
        });
      } else {
        // PENDING/RUNNING: atualiza payload/priority sem resetar status/attempts
        // (payload novo traz episodeUrl do catálogo; priority pode subir).
        await this.prisma.watchtowerJob
          .update({
            where: { id: existing.id },
            data: {
              payload: input.payload as object,
              priority: Math.min(
                existing.priority ?? 100,
                input.priority ?? 100,
              ),
            },
          })
          .catch(() => undefined);
      }
      return;
    }

    try {
      await this.prisma.watchtowerJob.create({
        data: {
          type: input.type,
          dedupeKey: input.dedupeKey,
          payload: input.payload as object,
          priority: input.priority ?? 100,
          maxAttempts: input.maxAttempts ?? 5,
          nextRunAt,
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation (dedupe race — another worker
      // inserted the same type+dedupeKey between our findUnique and create).
      if ((err as { code?: string })?.code === 'P2002') return;
      this.logger.error(
        `enqueue failed for ${input.type}:${input.dedupeKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
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

  /** Marca job como DONE, limpa lock. Guarda lockedBy p/ checar ownership. */
  async complete(id: string, lockedBy: string): Promise<void> {
    const r = await this.prisma.watchtowerJob.updateMany({
      where: { id, lockedBy },
      data: { status: 'DONE', lockedBy: null, lockedAt: null, lastError: null },
    });
    if (r.count === 0) {
      // Job foi reapado/claimado por outra instância — não clobber.
      this.logger.debug(
        `complete skip: job ${id} não está mais lockedBy ${lockedBy}`,
      );
    }
  }

  /** Marca falha: reenfileira com backoff ou marca DEAD se esgotou tentativas. */
  async fail(id: string, lockedBy: string, error: string): Promise<void> {
    const job = await this.prisma.watchtowerJob.findUnique({
      where: { id },
      select: { attempts: true, maxAttempts: true, lockedBy: true },
    });
    if (!job) return;
    // Outra instância já resetou/claimou — não clobber.
    if (job.lockedBy !== lockedBy) {
      this.logger.debug(
        `fail skip: job ${id} lockedBy diverge (esperado ${lockedBy}, atual ${job.lockedBy})`,
      );
      return;
    }

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

  /** Reset de jobs RUNNING presos (crash/restart). Incrementa attempts e
   * marca DEAD se esgotou maxAttempts (evita loop infinito de restart). */
  async reapStale(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const stale = await this.prisma.watchtowerJob.findMany({
      where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
      select: { id: true, attempts: true, maxAttempts: true },
    });
    if (stale.length === 0) return 0;

    let dead = 0;
    let pending = 0;
    for (const j of stale) {
      const newAttempts = (j.attempts ?? 0) + 1;
      const isDead = newAttempts >= (j.maxAttempts ?? 5);
      const backoff = this.backoffMs(j.attempts);
      await this.prisma.watchtowerJob
        .update({
          where: { id: j.id },
          data: {
            status: isDead ? 'DEAD' : 'PENDING',
            attempts: newAttempts,
            nextRunAt: isDead ? undefined : new Date(Date.now() + backoff),
            lockedBy: null,
            lockedAt: null,
            lastError: 'stale reap (worker crashed/timeout)',
          },
        })
        .catch(() => undefined);
      if (isDead) dead++;
      else pending++;
    }
    this.logger.log(
      `reapStale: ${stale.length} resetados (${pending} -> PENDING, ${dead} -> DEAD)`,
    );
    return stale.length;
  }

  /** Backoff exponencial (fonte única em watchtower.types). */
  private backoffMs(attempts: number): number {
    return nextBackoffMs(attempts);
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
