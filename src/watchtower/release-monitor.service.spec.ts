import { ReleaseMonitor } from '@/watchtower/release-monitor.service';

interface AiringEntry {
  airingAt: number;
  episode: number;
}

function makeMocks(airingSchedule: AiringEntry[] = []) {
  const existingEps = new Map<string, number[]>();
  return {
    prisma: {
      anime: {
        findMany: jest.fn(async () => [
          { id: 'anime-1', slug: 'solo', anilistId: 12345 },
        ]),
        findUnique: jest.fn(async (args: any) =>
          args.where.id === 'anime-1'
            ? { id: 'anime-1', slug: 'solo', anilistId: 12345 }
            : null,
        ),
      },
      episode: {
        findMany: jest.fn(async (args: any) => {
          const exist = existingEps.get(args.where.animeId) ?? [];
          return exist.map((n: number) => ({ number: n }));
        }),
      },
    },
    anilist: {
      airingSchedule: jest.fn(async () => airingSchedule),
    },
    jobs: {
      enqueue: jest.fn(async () => undefined),
    },
    existingEps,
  };
}

let m: ReturnType<typeof makeMocks>;

beforeEach(() => {
  m = makeMocks();
});

describe('ReleaseMonitor', () => {
  it('enfileira EXTRACT para episódios em falta', async () => {
    m = makeMocks([
      { airingAt: Math.floor(Date.now() / 1000) - 86400, episode: 1 },
      { airingAt: Math.floor(Date.now() / 1000) - 86400 * 2, episode: 2 },
    ]);
    const monitor = new ReleaseMonitor(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const enqueued = await monitor.checkAll();
    expect(enqueued).toBe(2);
    expect(m.jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(m.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EXTRACT_EPISODE',
        dedupeKey: expect.stringContaining('extract:anime-1:'),
        payload: expect.objectContaining({ animeId: 'anime-1', slug: 'solo' }),
      }),
    );
  });

  it('não enfileira episódios já no DB', async () => {
    m = makeMocks([
      { airingAt: Math.floor(Date.now() / 1000) - 3600, episode: 1 },
      { airingAt: Math.floor(Date.now() / 1000) - 7200, episode: 2 },
    ]);
    m.existingEps.set('anime-1', [1, 2]);
    const monitor = new ReleaseMonitor(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const enqueued = await monitor.checkAll();
    expect(enqueued).toBe(0);
    expect(m.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('ignora episódios não aireados ainda', async () => {
    m = makeMocks([
      { airingAt: Math.floor(Date.now() / 1000) + 86400, episode: 1 },
      { airingAt: Math.floor(Date.now() / 1000) - 3600, episode: 2 },
    ]);
    const monitor = new ReleaseMonitor(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const enqueued = await monitor.checkAll();
    expect(enqueued).toBe(1);
    expect(
      (m.jobs.enqueue.mock.calls[0] as unknown as any[] | undefined)?.[0]
        ?.payload?.episodeNumber,
    ).toBe(2);
  });

  it('checkOne enfileira para anime especifico', async () => {
    m = makeMocks([
      { airingAt: Math.floor(Date.now() / 1000) - 3600, episode: 5 },
    ]);
    const monitor = new ReleaseMonitor(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const enqueued = await monitor.checkOne('anime-1');
    expect(enqueued).toBe(1);
    expect(
      (m.jobs.enqueue.mock.calls[0] as unknown as any[] | undefined)?.[0]
        ?.payload?.episodeNumber,
    ).toBe(5);
  });

  it('checkOne retorna 0 quando anime não existe', async () => {
    const monitor = new ReleaseMonitor(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const enqueued = await monitor.checkOne('nope');
    expect(enqueued).toBe(0);
  });

  it('checkOne retorna 0 quando anime sem anilistId', async () => {
    m.prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'solo',
      anilistId: null as unknown as number,
    });
    const monitor = new ReleaseMonitor(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const enqueued = await monitor.checkOne('anime-1');
    expect(enqueued).toBe(0);
  });

  it('continua iteração quando airingSchedule falha', async () => {
    m.anilist.airingSchedule.mockRejectedValue(new Error('rate limit'));
    const monitor = new ReleaseMonitor(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const enqueued = await monitor.checkAll();
    expect(enqueued).toBe(0);
  });
});
