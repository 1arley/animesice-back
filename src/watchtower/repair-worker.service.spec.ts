import { RepairWorker } from '@/watchtower/repair-worker.service';

jest.mock('@/common/ssrf', () => ({
  resolveSafeUrl: jest.fn(async (url: string) => ({ url })),
  pinnedDispatcher: jest.fn(() => ({ close: jest.fn() })),
}));

function makeMocks() {
  const brokenEps: any[] = [];
  const sampleEps: any[] = [];
  const enqueue = jest.fn(async () => undefined);
  const enqueueMany = jest.fn(async () => undefined);
  const prisma = {
    episode: {
      findMany: jest.fn(async (args: any) => {
        if (args.where?.videoUrl)
          return sampleEps.slice(0, args.take ?? sampleEps.length);
        if (args.where?.OR)
          return brokenEps.slice(0, args.take ?? brokenEps.length);
        return [];
      }),
      update: jest.fn(async () => undefined),
      updateMany: jest.fn(async () => undefined),
    },
    $queryRaw: jest.fn(async () => []),
  };
  return { brokenEps, sampleEps, enqueue, enqueueMany, prisma };
}

let m: ReturnType<typeof makeMocks>;

beforeEach(() => {
  m = makeMocks();
});

const origFetch = global.fetch;
afterEach(() => {
  global.fetch = origFetch;
});

describe('RepairWorker', () => {
  it('enfileira REPAIR para episódios com videoUrl null/videoBroken', async () => {
    m.brokenEps.push(
      { id: 'ep1', animeId: 'a1', number: 1, season: 1 },
      { id: 'ep2', animeId: 'a2', number: 3, season: 1 },
    );
    const worker = new RepairWorker(
      m.prisma as any,
      { enqueue: m.enqueue, enqueueMany: m.enqueueMany } as any,
    );
    const enqueued = await worker.sweep();
    expect(enqueued).toBe(2);
    expect(m.enqueueMany).toHaveBeenCalledTimes(1);
    expect(m.enqueueMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'REPAIR_EPISODE',
          priority: 130,
          payload: { animeId: 'a1', episodeNumber: 1, season: 1 },
        }),
      ]),
    );
  });

  it('cap diário respeita WT_REPAIR_DAILY_CAP', async () => {
    process.env.WT_REPAIR_DAILY_CAP = '1';
    m.brokenEps.push(
      { id: 'ep1', animeId: 'a1', number: 1, season: 1 },
      { id: 'ep2', animeId: 'a2', number: 3, season: 1 },
    );
    const worker = new RepairWorker(
      m.prisma as any,
      { enqueue: m.enqueue, enqueueMany: m.enqueueMany } as any,
    );
    const enqueued = await worker.sweep();
    expect(enqueued).toBe(1);
    delete process.env.WT_REPAIR_DAILY_CAP;
  });

  it('probe de episódios antigos marca videoBroken e enfileira repair', async () => {
    process.env.WT_REPAIR_DAILY_CAP = '10';
    m.sampleEps.push({
      id: 'ep1',
      animeId: 'a1',
      number: 1,
      videoUrl: 'https://dead.test/v.mp4',
    });
    global.fetch = jest.fn(
      async () =>
        ({
          status: 403,
          headers: { get: () => null },
        }) as any,
    );
    const worker = new RepairWorker(
      m.prisma as any,
      { enqueue: m.enqueue, enqueueMany: m.enqueueMany } as any,
    );
    const enqueued = await worker.sweep();
    expect(enqueued).toBe(1);
    expect(m.prisma.episode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['ep1'] } },
        data: { videoBroken: true },
      }),
    );
    expect(m.enqueueMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: 'REPAIR_EPISODE' }),
      ]),
    );
    delete process.env.WT_REPAIR_DAILY_CAP;
  });

  it('detecta URL expirada por assinatura sem tocar a rede', async () => {
    process.env.WT_REPAIR_DAILY_CAP = '10';
    // expire no passado = token vencido; probe de rede não deve rodar.
    global.fetch = jest.fn(() => {
      throw new Error('rede não deveria ser chamada');
    });
    m.sampleEps.push({
      id: 'ep1',
      animeId: 'a1',
      number: 1,
      season: 1,
      videoUrl:
        'https://rr1---sn-x.googlevideo.com/videoplayback?expire=1000000000&ip=1.2.3.4',
    });
    const worker = new RepairWorker(
      m.prisma as any,
      { enqueue: m.enqueue, enqueueMany: m.enqueueMany } as any,
    );
    const enqueued = await worker.sweep();
    expect(enqueued).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(m.enqueueMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: 'REPAIR_EPISODE' }),
      ]),
    );
    delete process.env.WT_REPAIR_DAILY_CAP;
  });

  it('filtra o sweep por slug do anime', async () => {
    process.env.WT_REPAIR_DAILY_CAP = '10';
    m.brokenEps.push({ id: 'ep1', animeId: 'a1', number: 1, season: 1 });
    const worker = new RepairWorker(
      m.prisma as any,
      { enqueue: m.enqueue, enqueueMany: m.enqueueMany } as any,
    );
    await worker.sweep('bleach');
    expect(m.prisma.episode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          anime: { published: true, slug: 'bleach' },
        }),
      }),
    );
    delete process.env.WT_REPAIR_DAILY_CAP;
  });

  it('não repara episódios vivos no probe', async () => {
    process.env.WT_REPAIR_DAILY_CAP = '5';
    m.sampleEps.push({
      id: 'ep1',
      animeId: 'a1',
      number: 1,
      videoUrl: 'https://ok.test/v.mp4',
    });
    global.fetch = jest.fn(
      async () =>
        ({
          status: 200,
          headers: { get: () => null },
        }) as any,
    );
    const worker = new RepairWorker(
      m.prisma as any,
      { enqueue: m.enqueue, enqueueMany: m.enqueueMany } as any,
    );
    const enqueued = await worker.sweep();
    expect(enqueued).toBe(0);
    expect(m.enqueueMany).not.toHaveBeenCalled();
    delete process.env.WT_REPAIR_DAILY_CAP;
  });

  it('varre apenas episódios que não foram verificados nos últimos 7 dias', async () => {
    process.env.WT_REPAIR_DAILY_CAP = '5';
    const worker = new RepairWorker(
      m.prisma as any,
      { enqueue: m.enqueue, enqueueMany: m.enqueueMany } as any,
    );
    await worker.sweep();
    const sampleQuery = m.prisma.episode.findMany.mock.calls.find(([args]) =>
      Boolean(args.where?.videoUrl),
    )?.[0];
    expect(sampleQuery?.where.OR).toEqual([
      { videoCheckedAt: null },
      { videoCheckedAt: { lt: expect.any(Date) } },
    ]);
    expect(sampleQuery?.orderBy).toEqual([
      { videoCheckedAt: { sort: 'asc', nulls: 'first' } },
    ]);
    delete process.env.WT_REPAIR_DAILY_CAP;
  });

  it('enfileira backfill mesmo com fila grande e não repete jobs recentes', async () => {
    const episodes = [{ animeId: 'a1', slug: 'anime-1', number: 1, season: 1 }];
    m.prisma.$queryRaw = jest.fn(async () => episodes) as any;
    const worker = new RepairWorker(
      m.prisma as any,
      { enqueue: m.enqueue, enqueueMany: m.enqueueMany } as any,
    );
    expect(await worker.backfillSources()).toBe(1);
    expect(m.prisma.$queryRaw).toHaveBeenCalled();
    expect(m.enqueueMany).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:a1:1:1',
        priority: 105,
      }),
    ]);
  });

  it('marca reparos agendados em repairQueuedAt sem alterar videoCheckedAt', async () => {
    m.brokenEps.push({ id: 'broken-1', animeId: 'a1', number: 1, season: 1 });
    const worker = new RepairWorker(
      m.prisma as any,
      { enqueue: m.enqueue, enqueueMany: m.enqueueMany } as any,
    );
    await worker.sweep();
    expect(m.prisma.episode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['broken-1'] } },
      data: { repairQueuedAt: expect.any(Date) },
    });
  });
});
