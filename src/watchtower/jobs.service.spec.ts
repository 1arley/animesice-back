import { JobsService } from '@/watchtower/jobs.service';

function makeMockPrisma() {
  const store = new Map<string, any>(); // key = id

  return {
    store,
    watchtowerJob: {
      upsert: jest.fn(async (args: any) => {
        const tk = args.where?.type_dedupeKey;
        const type = tk?.type ?? args.create?.type;
        const dedupeKey = tk?.dedupeKey ?? args.create?.dedupeKey;
        const existing = [...store.values()].find(
          (j) => j.type === type && j.dedupeKey === dedupeKey,
        );
        if (existing) {
          return existing; // idempotent — keep original
        }
        const id = crypto.randomUUID();
        const row = {
          id,
          type,
          dedupeKey,
          payload: args.create?.payload ?? {},
          status: 'PENDING',
          priority: args.create?.priority ?? 100,
          attempts: 0,
          maxAttempts: args.create?.maxAttempts ?? 5,
          nextRunAt: args.create?.nextRunAt ?? new Date(),
          lastError: null,
          lockedBy: null,
          lockedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.set(id, row);
        return row;
      }),
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
          if (job.status === args.where?.status) {
            Object.assign(job, args.data);
            count++;
          }
        }
        return { count };
      }),
    },
  };
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
    await svc.complete(jobId);
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
    await svc.complete(jobId);
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
    await svc.fail(jobId, 'timeout');
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
    await svc.fail(jobId, 'err1');
    const row1 = mock.store.get(jobId)!;
    expect(row1.status).toBe('PENDING');
    await svc.fail(jobId, 'err2');
    const row2 = mock.store.get(jobId)!;
    expect(row2.status).toBe('DEAD');
    expect(row2.attempts).toBe(2);
  });

  it('reapStale reenfileira jobs RUNNING presos', async () => {
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
  });

  it('stats retorna agregação por status', async () => {
    const stats = await svc.stats();
    expect(stats).toHaveProperty('PENDING');
  });
});
