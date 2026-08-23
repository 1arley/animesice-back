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
        if (args.where?.OR)
          return brokenEps.slice(0, args.take ?? brokenEps.length);
        if (args.where?.videoUrl)
          return sampleEps.slice(0, args.take ?? sampleEps.length);
        return [];
      }),
      update: jest.fn(async () => undefined),
      updateMany: jest.fn(async () => undefined),
    },
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
          priority: 50,
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
});
