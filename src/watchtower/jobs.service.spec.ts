import { JobsService } from '@/watchtower/jobs.service';

function makeMockPrisma() {
  const store = new Map<string, any>(); // key = id

  const prisma = {
    store,
    watchtowerJob: {
      findMany: jest.fn(async (args: any) => {
        const want = args.where?.status ?? 'PENDING';
        return [...store.values()].filter((j) => j.status === want);
      }),
      findUnique: jest.fn(async (args: any) => {
        if (args.where?.id) return store.get(args.where?.id) ?? null;
        if (args.where?.type_dedupeKey) {
          const { type, dedupeKey } = args.where.type_dedupeKey;
          return (
            [...store.values()].find(
              (j) => j.type === type && j.dedupeKey === dedupeKey,
            ) ?? null
          );
        }
        return null;
      }),
      create: jest.fn(async (args: any) => {
        const id = crypto.randomUUID();
        const row = {
          id,
          type: args.data?.type,
          dedupeKey: args.data?.dedupeKey,
          payload: args.data?.payload ?? {},
          status: 'PENDING',
          priority: args.data?.priority ?? 100,
          attempts: 0,
          maxAttempts: args.data?.maxAttempts ?? 5,
          nextRunAt: args.data?.nextRunAt ?? new Date(),
          lastError: null,
          lockedBy: null,
          lockedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.set(id, row);
        return row;
      }),
      groupBy: jest.fn(async () => [{ status: 'PENDING', _count: 3 }]),
      update: jest.fn(async (args: any) => {
        const id = args.where?.id;
        if (!id || !store.has(id)) {
          // fallback: try by status condition (atomic claim)
          const candidates = [...store.values()].filter(
            (j) =>
              args.where?.status === undefined ||
              j.status === args.where.status,
          );
          if (candidates.length > 0) {
            Object.assign(candidates[0], args.data);
            return candidates[0];
          }
          throw new Error('not found');
        }
        Object.assign(store.get(id), args.data);
        return store.get(id);
      }),
      updateMany: jest.fn(async (args: any) => {
        let count = 0;
        for (const [_id, job] of store) {
          const idOk = args.where?.id === undefined || job.id === args.where.id;
          const lockedByOk =
            args.where?.lockedBy === undefined ||
            job.lockedBy === args.where.lockedBy;
          const statusOk =
            args.where?.status === undefined ||
            job.status === args.where.status;
          if (idOk && lockedByOk && statusOk) {
            Object.assign(job, args.data);
            count++;
          }
        }
        return { count };
      }),
    },
    $queryRaw: jest.fn(
      async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = strings.join(' ');
        if (sql.includes('WITH candidates')) {
          const lockId = values[1];
          const limit = values[0];
          const candidates = [...store.values()]
            .filter((job) => job.status === 'PENDING')
            .slice(0, limit);
          for (const job of candidates) {
            job.status = 'RUNNING';
            job.lockedBy = lockId;
            job.lockedAt = new Date();
          }
          return candidates;
        }
        const cutoff = values[0] as Date;
        const rows: Array<{ status: string }> = [];
        for (const job of store.values()) {
          if (
            job.status !== 'RUNNING' ||
            !job.lockedAt ||
            job.lockedAt >= cutoff
          )
            continue;
          job.attempts++;
          job.status = job.attempts >= job.maxAttempts ? 'DEAD' : 'PENDING';
          job.nextRunAt =
            job.status === 'DEAD'
              ? job.nextRunAt
              : new Date(Date.now() + 30_000 * 2 ** (job.attempts - 1));
          job.lockedBy = null;
          job.lockedAt = null;
          job.lastError = 'stale reap (worker crashed/timeout)';
          rows.push({ status: job.status });
        }
        return rows;
      },
    ),
    $executeRaw: jest.fn(async () => []),
  };
  return prisma;
}

describe('JobsService', () => {
  let mock: ReturnType<typeof makeMockPrisma>;
  let svc: JobsService;

  beforeEach(() => {
    mock = makeMockPrisma();
    svc = new JobsService(mock as any);
  });

  it('enqueue insere job PENDING', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:anime1:1',
      payload: { animeId: 'anime1', episodeNumber: 1, slug: 'slug' },
    });
    expect(mock.watchtowerJob.create).toHaveBeenCalledTimes(1);
    const row = [...mock.store.values()][0];
    expect(row).toBeDefined();
    expect(row.status).toBe('PENDING');
    expect(row.priority).toBe(100);
  });

  it('enqueue respeita priority custom', async () => {
    await svc.enqueue({
      type: 'REPAIR_EPISODE',
      dedupeKey: 'repair:anime1:1',
      payload: {},
      priority: 50,
    });
    const row = [...mock.store.values()][0];
    expect(row.priority).toBe(50);
  });

  it('enqueue idempotente não duplica', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:dup:1',
      payload: {},
    });
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:dup:1',
      payload: {},
    });
    expect(mock.store.size).toBe(1);
  });

  it('enqueue reseta job DONE para PENDING', async () => {
    await svc.enqueue({
      type: 'CHECK_RELEASES',
      dedupeKey: 'check-releases',
      payload: {},
    });
    const claimed = await svc.claimBatch(1);
    const jobId = claimed[0]!.id;
    const lockedBy = claimed[0]!.lockedBy!;
    await svc.complete(jobId, lockedBy);
    const row = mock.store.get(jobId)!;
    expect(row.status).toBe('DONE');

    await svc.enqueue({
      type: 'CHECK_RELEASES',
      dedupeKey: 'check-releases',
      payload: {},
    });
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(0);
  });

  it('enqueue não reseta job PENDING existente', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:pend:1',
      payload: {},
    });
    const before = [...mock.store.values()][0];
    const originalNextRunAt = before.nextRunAt;

    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:pend:1',
      payload: {},
    });
    expect(mock.store.size).toBe(1);
    expect(before.nextRunAt).toBe(originalNextRunAt);
  });

  it('claimBatch marca jobs como RUNNING', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:c1:1',
      payload: {},
    });
    const claimed = await svc.claimBatch(5);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.status).toBe('RUNNING');
    expect(claimed[0]!.lockedBy).toBeDefined();
  });

  it('complete marca DONE e limpa lock', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:comp:1',
      payload: {},
    });
    const claimed = await svc.claimBatch(1);
    const jobId = claimed[0]!.id;
    const lockedBy = claimed[0]!.lockedBy!;
    await svc.complete(jobId, lockedBy);
    const row = mock.store.get(jobId)!;
    expect(row.status).toBe('DONE');
    expect(row.lockedBy).toBeNull();
  });

  it('fail incrementa attempts e reenfileira com backoff', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:fail:1',
      payload: { slug: 'an', episodeNumber: 1, animeId: 'a' },
      maxAttempts: 5,
    });
    const claimed = await svc.claimBatch(1);
    const jobId = claimed[0]!.id;
    const lockedBy = claimed[0]!.lockedBy!;
    await svc.fail(jobId, lockedBy, 'timeout');
    const row = mock.store.get(jobId)!;
    expect(row.attempts).toBe(1);
    expect(row.status).toBe('PENDING');
    expect(row.lastError).toBe('timeout');
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('fail marca DEAD ao esgotar maxAttempts', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:dead:1',
      payload: {},
      maxAttempts: 2,
    });
    const claimed = await svc.claimBatch(1);
    const jobId = claimed[0]!.id;
    const lockedBy = claimed[0]!.lockedBy!;
    await svc.fail(jobId, lockedBy, 'err1');
    const row1 = mock.store.get(jobId)!;
    expect(row1.status).toBe('PENDING');
    // re-claim para obter novo lockedBy após re-enfileiramento
    const claimed2 = await svc.claimBatch(1);
    const lockedBy2 = claimed2[0]!.lockedBy!;
    await svc.fail(jobId, lockedBy2, 'err2');
    const row2 = mock.store.get(jobId)!;
    expect(row2.status).toBe('DEAD');
    expect(row2.attempts).toBe(2);
  });

  it('reapStale reenfileira jobs RUNNING presos (incrementa attempts)', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:stale:1',
      payload: {},
    });
    const claimed = await svc.claimBatch(1);
    const jobId = claimed[0]!.id;
    const row = mock.store.get(jobId)!;
    row.lockedAt = new Date(Date.now() - 20 * 60_000);
    const count = await svc.reapStale(10 * 60_000);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(row.status).toBe('PENDING');
    expect(row.lockedBy).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('stale reap (worker crashed/timeout)');
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('reapStale marca DEAD ao esgotar maxAttempts', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:stale:dead',
      payload: {},
      maxAttempts: 1,
    });
    const claimed = await svc.claimBatch(1);
    const jobId = claimed[0]!.id;
    const row = mock.store.get(jobId)!;
    row.lockedAt = new Date(Date.now() - 20 * 60_000);
    const count = await svc.reapStale(10 * 60_000);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(row.status).toBe('DEAD');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('stale reap (worker crashed/timeout)');
  });

  it('stats retorna agregação por status', async () => {
    const stats = await svc.stats();
    expect(stats).toHaveProperty('PENDING');
  });

  it('enqueue engole P2002 (race de dedupe)', async () => {
    mock.watchtowerJob.findUnique.mockResolvedValue(null);
    mock.watchtowerJob.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      svc.enqueue({
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:race:1',
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('enqueue loga erro não-P2002', async () => {
    mock.watchtowerJob.findUnique.mockResolvedValue(null);
    mock.watchtowerJob.create.mockRejectedValue(new Error('db down'));
    const loggerSpy = jest.spyOn(svc['logger'], 'error').mockImplementation();
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:err:1',
      payload: {},
    });
    expect(loggerSpy).toHaveBeenCalled();
  });

  it('complete com count 0 não lança erro', async () => {
    mock.watchtowerJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.complete('nope', 'lock')).resolves.toBeUndefined();
  });

  it('fail com job inexistente retorna silenciosamente', async () => {
    mock.watchtowerJob.findUnique.mockResolvedValue(null);
    await expect(svc.fail('nope', 'lock', 'err')).resolves.toBeUndefined();
  });

  it('fail com lockedBy divergente retorna silenciosamente', async () => {
    await svc.enqueue({
      type: 'EXTRACT_EPISODE',
      dedupeKey: 'extract:lockdiv:1',
      payload: {},
    });
    const claimed = await svc.claimBatch(1);
    const jobId = claimed[0]!.id;
    await expect(svc.fail(jobId, 'wrong-lock', 'err')).resolves.toBeUndefined();
  });

  it('enqueueMany insere múltiplos jobs', async () => {
    await svc.enqueueMany([
      {
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:batch:1',
        payload: { slug: 'a' },
      },
      {
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:batch:2',
        payload: { slug: 'b' },
      },
    ]);
    expect(mock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('enqueueMany com lista vazia não executa', async () => {
    await svc.enqueueMany([]);
    expect(mock.$executeRaw).not.toHaveBeenCalled();
  });

  it('reschedule transforma RUNNING em PENDING com payload novo e limpa lock', async () => {
    await svc.enqueue({
      type: 'SYNC_SCHEDULES',
      dedupeKey: 'sync-schedules',
      payload: {},
    });
    const claimed = await svc.claimBatch(1);
    const job = claimed[0]!;
    expect(job.status).toBe('RUNNING');

    const nextRunAt = new Date(Date.now() + 60_000);
    const ok = await svc.reschedule(
      job.id,
      job.lockedBy!,
      { afterId: 'abc' },
      nextRunAt,
    );
    expect(ok).toBe(true);

    const row = mock.store.get(job.id)!;
    expect(row.status).toBe('PENDING');
    expect(row.payload).toEqual({ afterId: 'abc' });
    expect(row.lockedBy).toBeNull();
    expect(row.lockedAt).toBeNull();
    expect(row.lastError).toBeNull();
  });

  it('reschedule retorna false quando lockedBy não bate (outra instância)', async () => {
    await svc.enqueue({
      type: 'SYNC_SCHEDULES',
      dedupeKey: 'sync-schedules:diverge',
      payload: {},
    });
    const claimed = await svc.claimBatch(1);
    const job = claimed[0]!;
    const ok = await svc.reschedule(
      job.id,
      'wrong-lock',
      { afterId: 'x' },
      new Date(),
    );
    expect(ok).toBe(false);
    expect(mock.store.get(job.id)!.status).toBe('RUNNING');
  });

  it('reschedule retorna false quando status não é mais RUNNING', async () => {
    await svc.enqueue({
      type: 'SYNC_SCHEDULES',
      dedupeKey: 'sync-schedules:done',
      payload: {},
    });
    const claimed = await svc.claimBatch(1);
    const job = claimed[0]!;
    await svc.complete(job.id, job.lockedBy!);
    const ok = await svc.reschedule(
      job.id,
      job.lockedBy!,
      { afterId: 'x' },
      new Date(),
    );
    expect(ok).toBe(false);
  });

  it('enqueue não sobrescreve payload de job RUNNING com cursor ativo', async () => {
    await svc.enqueue({
      type: 'SYNC_SCHEDULES',
      dedupeKey: 'sync-schedules:cursor',
      payload: { afterId: 'old-cursor' },
    });
    const claimed = await svc.claimBatch(1);
    const job = claimed[0]!;
    expect(job.status).toBe('RUNNING');

    // tenta enqueue com payload diferente (ex: startup) — não deve sobrescrever
    await svc.enqueue({
      type: 'SYNC_SCHEDULES',
      dedupeKey: 'sync-schedules:cursor',
      payload: {},
    });

    const row = mock.store.get(job.id)!;
    expect(row.payload).toEqual({ afterId: 'old-cursor' });
    expect(row.status).toBe('RUNNING');
  });

  it('enqueue respeita job PENDING sem cursor (aceita novo payload)', async () => {
    await svc.enqueue({
      type: 'SYNC_SCHEDULES',
      dedupeKey: 'sync-schedules:pend',
      payload: {},
    });
    const row = [...mock.store.values()][0]!;
    expect(row.status).toBe('PENDING');

    await svc.enqueue({
      type: 'SYNC_SCHEDULES',
      dedupeKey: 'sync-schedules:pend',
      payload: { priority: true },
    });
    expect(row.payload).toEqual({ priority: true });
  });
});
