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
import { Prisma } from '@prisma/client';
import { nextBackoffMs, priorityForSlug } from './watchtower.types';

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
    // Backfill priorizado: se o payload referencia um anime da lista
    // PRIORITY_SLUGS, o job entra com prioridade urgente (PRIORITY_BOOST).
    const slug = (input.payload as { slug?: string } | null)?.slug ?? null;
    const priority = priorityForSlug(slug, input.priority ?? 100);

    const existing = await this.prisma.watchtowerJob.findUnique({
      where: {
        type_dedupeKey: { type: input.type, dedupeKey: input.dedupeKey },
      },
      select: { id: true, status: true, priority: true },
    });

    if (existing) {
      // Singleton com paginação em curso: se o payload atual carrega um cursor
      // (afterId) ativo, NÃO sobrescreva. Continuação é owned pelo worker
      // que detém o lock; re-enfileiramentos diários/startup só refrescam
      // prioridade ou marcam para re-executar quando DONE.
      const payloadHasCursor =
        typeof (existing as unknown as { payload?: { afterId?: unknown } })
          ?.payload === 'object' &&
        (existing as unknown as { payload?: { afterId?: unknown } })?.payload
          ?.afterId !== undefined;

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
            priority,
          },
        });
      } else if (payloadHasCursor && existing.status === 'RUNNING') {
        // Paginação em curso — não toca no payload nem no lock.
        return;
      } else {
        // PENDING sem cursor (próximo arranque) ou RUNNING sem cursor: aceita
        // novo payload e atualiza prioridade.
        await this.prisma.watchtowerJob
          .update({
            where: { id: existing.id },
            data: {
              payload: input.payload as object,
              priority: Math.min(existing.priority ?? 100, priority),
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
          priority,
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

  /**
   * Continuação owned: o worker ainda dono (lockedBy) transforma o próprio
   * job RUNNING em PENDING com novo payload (cursor) e nextRunAt. Garante
   * apenas UM job singleton ativo no sistema — sem criar nova row e sem
   * clobberar o lock de outra instância. É a primitiva que sustenta
   * paginação keyset (syncSchedules) sem race nem duplicação.
   *
   * Se o lock já não pertence ao caller (stale reap, restart), retorna false
   * e nada é alterado — o caller pode ignorar ou logar.
   */
  async reschedule(
    id: string,
    lockedBy: string,
    payload: unknown,
    nextRunAt: Date,
  ): Promise<boolean> {
    const r = await this.prisma.watchtowerJob.updateMany({
      where: { id, lockedBy, status: 'RUNNING' },
      data: {
        status: 'PENDING',
        payload: payload as object,
        nextRunAt,
        lockedBy: null,
        lockedAt: null,
        lastError: null,
      },
    });
    return r.count > 0;
  }

  /** Insere/atualiza vários jobs em uma única ida ao PostgreSQL. */
  async enqueueMany(inputs: EnqueueInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const rows = inputs.map((input) => {
      const slug = (input.payload as { slug?: string } | null)?.slug ?? null;
      return Prisma.sql`(
        ${input.type}, ${input.dedupeKey},
        CAST(${JSON.stringify(input.payload ?? {})} AS jsonb),
        ${priorityForSlug(slug, input.priority ?? 100)},
        ${input.maxAttempts ?? 5}, NOW()
      )`;
    });

    await this.prisma.$executeRaw`
      INSERT INTO "WatchtowerJob"
        ("id", "type", "dedupeKey", "payload", "priority", "maxAttempts",
         "nextRunAt", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, v.type, v.dedupe_key, v.payload,
             v.priority, v.max_attempts, v.next_run_at, NOW(), NOW()
      FROM (VALUES ${Prisma.join(rows)})
        AS v(type, dedupe_key, payload, priority, max_attempts, next_run_at)
      ON CONFLICT ("type", "dedupeKey") DO UPDATE SET
        "payload" = EXCLUDED."payload",
        "priority" = LEAST("WatchtowerJob"."priority", EXCLUDED."priority"),
        "status" = CASE
          WHEN "WatchtowerJob"."status" IN ('DONE', 'DEAD') THEN 'PENDING'
          ELSE "WatchtowerJob"."status"
        END,
        "attempts" = CASE
          WHEN "WatchtowerJob"."status" IN ('DONE', 'DEAD') THEN 0
          ELSE "WatchtowerJob"."attempts"
        END,
        "nextRunAt" = CASE
          WHEN "WatchtowerJob"."status" IN ('DONE', 'DEAD') THEN NOW()
          ELSE "WatchtowerJob"."nextRunAt"
        END,
        "lastError" = CASE
          WHEN "WatchtowerJob"."status" IN ('DONE', 'DEAD') THEN NULL
          ELSE "WatchtowerJob"."lastError"
        END,
        "lockedBy" = CASE
          WHEN "WatchtowerJob"."status" IN ('DONE', 'DEAD') THEN NULL
          ELSE "WatchtowerJob"."lockedBy"
        END,
        "lockedAt" = CASE
          WHEN "WatchtowerJob"."status" IN ('DONE', 'DEAD') THEN NULL
          ELSE "WatchtowerJob"."lockedAt"
        END,
        "updatedAt" = NOW()
    `;
  }

  /** Claim N jobs devidos (status=PENDING, nextRunAt<=agora), mais urgentes 1º. */
  async claimBatch(limit: number): Promise<WatchtowerJobRow[]> {
    const lockId = crypto.randomUUID();
    return this.prisma.$queryRaw<WatchtowerJobRow[]>`
      WITH candidates AS (
        SELECT "id" FROM "WatchtowerJob"
        WHERE "status" = 'PENDING' AND "nextRunAt" <= NOW()
        ORDER BY "priority" ASC, "nextRunAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(0, limit)}
      )
      UPDATE "WatchtowerJob" AS job
      SET "status" = 'RUNNING', "lockedBy" = ${lockId},
          "lockedAt" = NOW(), "updatedAt" = NOW()
      FROM candidates
      WHERE job."id" = candidates."id"
      RETURNING job.*
    `;
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
    const rows = await this.prisma.$queryRaw<Array<{ status: string }>>`
      UPDATE "WatchtowerJob"
      SET "attempts" = "attempts" + 1,
          "status" = CASE
            WHEN "attempts" + 1 >= "maxAttempts" THEN 'DEAD'
            ELSE 'PENDING'
          END,
          "nextRunAt" = CASE
            WHEN "attempts" + 1 >= "maxAttempts" THEN "nextRunAt"
            ELSE NOW() + (
              LEAST(3600000, 30000 * POWER(2, "attempts"))::text ||
              ' milliseconds'
            )::interval
          END,
          "lockedBy" = NULL, "lockedAt" = NULL,
          "lastError" = 'stale reap (worker crashed/timeout)',
          "updatedAt" = NOW()
      WHERE "status" = 'RUNNING' AND "lockedAt" < ${cutoff}
      RETURNING "status"
    `;
    const dead = rows.filter(({ status }) => status === 'DEAD').length;
    const pending = rows.length - dead;
    this.logger.log(
      `reapStale: ${rows.length} resetados (${pending} -> PENDING, ${dead} -> DEAD)`,
    );
    return rows.length;
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
