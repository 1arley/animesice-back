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
      select: { id: true, status: true, priority: true, payload: true },
    });

    if (existing) {
      // Payload e lock de um job em execução pertencem ao worker que o claimou.
      const payload = existing.payload;

      if (existing.status === 'RUNNING') return;

      if (existing.status === 'DONE' || existing.status === 'DEAD') {
        await this.prisma.watchtowerJob.updateMany({
          where: { id: existing.id, status: existing.status },
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
      } else {
        const previousPayload =
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>)
            : null;
        const nextPayload =
          previousPayload && 'rustFallbackAt' in previousPayload
            ? {
                ...((input.payload ?? {}) as Record<string, unknown>),
                rustEligible: false,
                rustFallbackAt: previousPayload.rustFallbackAt,
              }
            : input.payload;
        await this.prisma.watchtowerJob.updateMany({
          where: { id: existing.id, status: 'PENDING' },
          data: {
            payload: nextPayload as object,
            priority: Math.min(existing.priority ?? 100, priority),
          },
        });
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
      throw err;
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
  async enqueueMany(
    inputs: EnqueueInput[],
    maxPendingRepairs?: number,
  ): Promise<string[]> {
    if (inputs.length === 0) return [];
    const unique = new Map<string, EnqueueInput>();
    for (const input of inputs) {
      const key = `${input.type}:${input.dedupeKey}`;
      const existing = unique.get(key);
      if (!existing || (input.priority ?? 100) < (existing.priority ?? 100)) {
        unique.set(key, input);
      }
    }
    return this.prisma.$transaction(async (tx) => {
      let selected = [...unique.values()];
      if (maxPendingRepairs !== undefined) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(991233, 2)`;
        const pending = await tx.watchtowerJob.count({
          where: {
            type: 'REPAIR_EPISODE',
            status: { in: ['PENDING', 'RUNNING'] },
          },
        });
        const slots = Math.max(0, maxPendingRepairs - pending);
        const repairs = selected
          .filter((input) => input.type === 'REPAIR_EPISODE')
          .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
        const other = selected.filter(
          (input) => input.type !== 'REPAIR_EPISODE',
        );
        selected = [...other, ...repairs.slice(0, slots)];
      }
      if (selected.length === 0) return [];

      const rows = selected.map((input) => {
        const slug = (input.payload as { slug?: string } | null)?.slug ?? null;
        return Prisma.sql`(
          ${input.type}, ${input.dedupeKey},
          CAST(${JSON.stringify(input.payload ?? {})} AS jsonb),
          ${priorityForSlug(slug, input.priority ?? 100)},
          ${input.maxAttempts ?? 5}, NOW()
        )`;
      });
      const inserted = await tx.$queryRaw<Array<{ dedupeKey: string }>>`
        INSERT INTO "WatchtowerJob"
          ("id", "type", "dedupeKey", "payload", "priority", "maxAttempts",
           "nextRunAt", "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, v.type, v.dedupe_key, v.payload,
               v.priority::int, v.max_attempts::int, v.next_run_at, NOW(), NOW()
        FROM (VALUES ${Prisma.join(rows)})
          AS v(type, dedupe_key, payload, priority, max_attempts, next_run_at)
        ON CONFLICT ("type", "dedupeKey") DO UPDATE SET
          "payload" = CASE
            WHEN "WatchtowerJob"."status" = 'RUNNING'
            THEN "WatchtowerJob"."payload"
            WHEN "WatchtowerJob"."status" = 'PENDING'
              AND "WatchtowerJob"."payload" ? 'rustFallbackAt'
            THEN EXCLUDED."payload" || jsonb_build_object(
              'rustEligible', false,
              'rustFallbackAt', "WatchtowerJob"."payload"->'rustFallbackAt'
            )
            ELSE EXCLUDED."payload"
          END,
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
        RETURNING "dedupeKey"
      `;
      return inserted.map((row) => row.dedupeKey);
    });
  }

  /**
   * Claim N jobs devidos (status=PENDING, nextRunAt<=agora), mais urgentes 1º.
   *
   * Reserva um slot para escoar reparos antigos quando há concorrência. O
   * restante usa aging por tempo vencido, sem depender do relógio do cron.
   */
  async claimBatch(
    limit: number,
    rustRepairEnabled = false,
  ): Promise<WatchtowerJobRow[]> {
    const lockId = crypto.randomUUID();
    const batchSize = Math.max(0, limit);
    const repairSlots = batchSize > 1 ? 1 : 0;
    return this.prisma.$queryRaw<WatchtowerJobRow[]>`
      WITH repair_candidates AS (
        SELECT "id" FROM "WatchtowerJob"
        WHERE "status" = 'PENDING' AND "nextRunAt" <= NOW()
          AND "type" = 'REPAIR_EPISODE'
          AND (
            NOT ${rustRepairEnabled}
            OR "payload"->>'rustEligible' IS DISTINCT FROM 'true'
            OR NOT EXISTS (
              SELECT 1 FROM pg_locks
              WHERE locktype = 'advisory' AND granted
                AND classid = 991233::oid AND objid = 1::oid AND objsubid = 2
            )
          )
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${repairSlots}
      ),
      reserved_candidates AS (
        SELECT "id" FROM repair_candidates
      ),
      regular_candidates AS (
        SELECT "id" FROM "WatchtowerJob"
        WHERE "status" = 'PENDING' AND "nextRunAt" <= NOW()
          AND (
            NOT ${rustRepairEnabled}
            OR "type" <> 'REPAIR_EPISODE'
            OR "payload"->>'rustEligible' IS DISTINCT FROM 'true'
            OR NOT EXISTS (
              SELECT 1 FROM pg_locks
              WHERE locktype = 'advisory' AND granted
                AND classid = 991233::oid AND objid = 1::oid AND objsubid = 2
            )
          )
          AND "id" NOT IN (SELECT "id" FROM reserved_candidates)
        ORDER BY GREATEST(
          1,
          "priority" - LEAST(
            "priority" - 1,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - "nextRunAt")) / 3600)::int
          )
        ) ASC, "nextRunAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize} - (SELECT COUNT(*) FROM reserved_candidates)
      ),
      candidates AS (
        SELECT "id" FROM reserved_candidates
        UNION ALL
        SELECT "id" FROM regular_candidates
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
      where: { id, lockedBy, status: 'RUNNING' },
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

    const updated = await this.prisma.watchtowerJob.updateMany({
      where: { id, lockedBy, status: 'RUNNING' },
      data: {
        status: isDead ? 'DEAD' : 'PENDING',
        attempts: newAttempts,
        lastError: error.slice(0, 2000),
        nextRunAt: isDead ? undefined : new Date(Date.now() + backoff),
        lockedBy: null,
        lockedAt: null,
      },
    });
    if (updated.count === 0) return;
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
