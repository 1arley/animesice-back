import { WorkerService } from '@/watchtower/worker.service';

function makeMocks() {
  return {
    prisma: {
      anime: {
        findUnique: jest.fn(async (args: any) => {
          const id = args.where?.id ?? args.where?.slug ?? 'anime-1';
          const out: any = { id, slug: 'solo', coverImage: 'cover.jpg' };
          if (args.select && !args.select.id) delete out.id;
          if (args.select && !args.select.slug) delete out.slug;
          if (args.select && !args.select.coverImage) delete out.coverImage;
          return out;
        }),
        findMany: jest.fn(async () => []),
      },
      $queryRaw: jest.fn(async () => []),
    },
    jobs: {
      complete: jest.fn(async () => undefined),
      fail: jest.fn(async () => undefined),
      enqueueMany: jest.fn(async (..._args: any[]) => undefined),
      reschedule: jest.fn(async () => true),
    },
    episodes: {
      resolveAndPublish: jest.fn(async () => ({
        videoUrl: 'new.mp4',
        sourceId: 'meusanimes',
        embedUrl: 'https://meusanimes.blog/e/solo/',
        status: 'published',
      })),
    },
    release: {
      checkAll: jest.fn(async () => 0),
      checkOne: jest.fn(async () => 0),
    },
    season: {
      discover: jest.fn(async () => 0),
    },
    repair: {
      sweep: jest.fn(async () => 0),
    },
    catalog: {
      scanAll: jest.fn(async () => ({ scanned: 0, enqueued: 0 })),
      processScanCatalog: jest.fn(async () => ({ found: 0, missing: 0 })),
    },
    schedule: {
      backfillAnilistPage: jest.fn(async () => ({
        matched: 0,
        nextAfterId: null,
      })),
      syncSchedules: jest.fn(),
    },
  };
}

let m = makeMocks();

function makeWorker() {
  return new WorkerService(
    m.prisma as any,
    m.jobs as any,
    m.episodes as any,
    m.release as any,
    m.season as any,
    m.repair as any,
    m.catalog as any,
    m.schedule as any,
  );
}

function job(overrides: {
  id: string;
  type: string;
  dedupeKey: string;
  payload: unknown;
}) {
  return {
    id: overrides.id,
    type: overrides.type,
    dedupeKey: overrides.dedupeKey,
    payload: overrides.payload,
    status: 'RUNNING',
    priority: 100,
    attempts: 0,
    maxAttempts: 5,
    nextRunAt: new Date(),
    lastError: null,
    lockedBy: null,
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

beforeEach(() => {
  m = makeMocks();
  jest.clearAllMocks();
});

describe('WorkerService', () => {
  it('process EXTRACT_EPISODE sucesso: delega para episodes.resolveAndPublish(mode=extract) e completa', async () => {
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-1',
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:anime-1:1',
        payload: { animeId: 'anime-1', slug: 'solo', episodeNumber: 1 },
      }),
    );
    expect(m.episodes.resolveAndPublish).toHaveBeenCalledWith({
      animeId: 'anime-1',
      slug: 'solo',
      episodeNumber: 1,
      season: 1,
      episodeUrl: undefined,
      mode: 'extract',
    });
    expect(m.jobs.complete).toHaveBeenCalledWith('job-1', '');
  });

  it('process EXTRACT_EPISODE falha quando episodes.resolveAndPublish rejeita', async () => {
    m.episodes.resolveAndPublish.mockRejectedValueOnce(
      new Error('Nenhuma fonte retornou vídeo p/ solo/s1/1'),
    );
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-2',
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:anime-1:1',
        payload: { animeId: 'anime-1', slug: 'solo', episodeNumber: 1 },
      }),
    );
    expect(m.jobs.fail).toHaveBeenCalledWith(
      'job-2',
      '',
      expect.stringContaining('Nenhuma fonte'),
    );
  });

  it('process CHECK_RELEASES delega para release.checkAll', async () => {
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-3',
        type: 'CHECK_RELEASES',
        dedupeKey: 'check',
        payload: {},
      }),
    );
    expect(m.release.checkAll).toHaveBeenCalledTimes(1);
    expect(m.jobs.complete).toHaveBeenCalledWith('job-3', '');
  });

  it('process DISCOVER_SEASON delega para season.discover', async () => {
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-4',
        type: 'DISCOVER_SEASON',
        dedupeKey: 'discover',
        payload: {},
      }),
    );
    expect(m.season.discover).toHaveBeenCalledTimes(1);
  });

  it('process tipo desconhecido marca fail', async () => {
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-x',
        type: 'UNKNOWN_TYPE',
        dedupeKey: 'x',
        payload: {},
      }),
    );
    expect(m.jobs.fail).toHaveBeenCalledWith(
      'job-x',
      '',
      expect.stringContaining('desconhecido'),
    );
  });

  it('process BACKFILL_ANILIST delega para schedule.backfillAnilistPage e completa quando última página', async () => {
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-ba',
        type: 'BACKFILL_ANILIST',
        dedupeKey: 'backfill-anilist',
        payload: {},
      }),
    );
    expect(m.schedule.backfillAnilistPage).toHaveBeenCalledTimes(1);
    expect(m.jobs.complete).toHaveBeenCalledWith('job-ba', '');
  });

  it('process BACKFILL_ANILIST faz reschedule quando há mais páginas e falha se perder lock', async () => {
    m.schedule.backfillAnilistPage.mockResolvedValueOnce({
      matched: 10,
      nextAfterId: 'anime-99',
    } as any);
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-ba-cont',
        type: 'BACKFILL_ANILIST',
        dedupeKey: 'backfill-anilist',
        payload: { afterId: 'anime-50' },
      }),
    );
    expect(m.jobs.reschedule).toHaveBeenCalledWith(
      'job-ba-cont',
      '',
      { afterId: 'anime-99' },
      expect.any(Date),
    );

    m.schedule.backfillAnilistPage.mockResolvedValueOnce({
      matched: 10,
      nextAfterId: 'anime-100',
    } as any);
    m.jobs.reschedule.mockResolvedValueOnce(false);
    await worker.process(
      job({
        id: 'job-ba-lost',
        type: 'BACKFILL_ANILIST',
        dedupeKey: 'backfill-anilist',
        payload: {},
      }),
    );
    expect(m.jobs.fail).toHaveBeenCalledWith(
      'job-ba-lost',
      '',
      expect.stringContaining('reschedule do backfill falhou'),
    );
  });

  it('process SYNC_SCHEDULES delega para schedule.syncSchedules e completa quando página termina', async () => {
    m.schedule.syncSchedules.mockResolvedValueOnce({
      synced: 5,
      continued: false,
      nextAfterId: null,
    });
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-ss',
        type: 'SYNC_SCHEDULES',
        dedupeKey: 'sync-schedules',
        payload: {},
      }),
    );
    expect(m.schedule.syncSchedules).toHaveBeenCalledTimes(1);
    expect(m.jobs.complete).toHaveBeenCalledWith('job-ss', '');
    expect(m.jobs.reschedule).not.toHaveBeenCalled();
  });

  it('process SYNC_SCHEDULES reschedule quando há mais páginas', async () => {
    m.schedule.syncSchedules.mockResolvedValueOnce({
      synced: 25,
      continued: true,
      nextAfterId: 'anime-24',
    });
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-ss-continued',
        type: 'SYNC_SCHEDULES',
        dedupeKey: 'sync-schedules',
        payload: {},
      }),
    );
    expect(m.jobs.complete).not.toHaveBeenCalled();
    expect(m.jobs.reschedule).toHaveBeenCalledWith(
      'job-ss-continued',
      '',
      { afterId: 'anime-24' },
      expect.any(Date),
    );
  });

  it('process SYNC_SCHEDULES fail quando reschedule retorna false (lock perdido)', async () => {
    m.schedule.syncSchedules.mockResolvedValueOnce({
      synced: 25,
      continued: true,
      nextAfterId: 'anime-24',
    });
    m.jobs.reschedule.mockResolvedValueOnce(false);
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-ss-lostlock',
        type: 'SYNC_SCHEDULES',
        dedupeKey: 'sync-schedules',
        payload: {},
      }),
    );
    expect(m.jobs.fail).toHaveBeenCalledWith(
      'job-ss-lostlock',
      '',
      expect.stringContaining('reschedule falhou'),
    );
    expect(m.jobs.complete).not.toHaveBeenCalled();
  });

  it('process REPAIR_EPISODE delega para episodes.resolveAndPublish(mode=repair) repassando rustFallback', async () => {
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-repair',
        type: 'REPAIR_EPISODE',
        dedupeKey: 'repair:anime-1:1:3',
        payload: {
          animeId: 'anime-1',
          episodeNumber: 3,
          rustFallbackUrl: 'https://animesonline.cloud/episodio/solo-3',
          rustFallbackSourceId: 'animesonline',
        },
      }),
    );
    expect(m.episodes.resolveAndPublish).toHaveBeenCalledWith({
      animeId: 'anime-1',
      episodeNumber: 3,
      season: 1,
      rustFallbackUrl: 'https://animesonline.cloud/episodio/solo-3',
      rustFallbackSourceId: 'animesonline',
      mode: 'repair',
    });
    expect(m.jobs.complete).toHaveBeenCalledWith('job-repair', '');
  });

  it('process SYNC_AIRING delega para release.checkAll', async () => {
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-sa',
        type: 'SYNC_AIRING',
        dedupeKey: 'sync-airing',
        payload: {},
      }),
    );
    expect(m.release.checkAll).toHaveBeenCalledTimes(1);
    expect(m.jobs.complete).toHaveBeenCalledWith('job-sa', '');
  });

  it('process SCAN_CATALOG com animeId+slug chama processScanCatalog', async () => {
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-sc1',
        type: 'SCAN_CATALOG',
        dedupeKey: 'scan-catalog:anime-1',
        payload: { animeId: 'anime-1', slug: 'solo' },
      }),
    );
    expect(m.catalog.processScanCatalog).toHaveBeenCalledWith(
      'anime-1',
      'solo',
    );
    expect(m.jobs.complete).toHaveBeenCalledWith('job-sc1', '');
  });

  it('process SCAN_CATALOG sem payload chama scanAll', async () => {
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-sc2',
        type: 'SCAN_CATALOG',
        dedupeKey: 'scan-all',
        payload: {},
      }),
    );
    expect(m.catalog.scanAll).toHaveBeenCalledTimes(1);
    expect(m.jobs.complete).toHaveBeenCalledWith('job-sc2', '');
  });

  it('process GAP_CHECK enfileira jobs p/ gaps e animes incompletos', async () => {
    m.prisma.$queryRaw = jest.fn(async () => [
      { animeId: 'g1', slug: 'gap-anime', gapCount: BigInt(1) },
    ]) as any;
    m.prisma.anime.findMany = jest.fn(async () => [
      {
        id: 'i1',
        slug: 'incomplete',
        episodeCount: 12,
        _count: { episodes: 5 },
      },
      {
        id: 'i2',
        slug: 'complete',
        episodeCount: 12,
        _count: { episodes: 12 },
      },
      { id: 'i3', slug: 'no-count', episodeCount: 0, _count: { episodes: 0 } },
    ]) as any;
    m.jobs.enqueueMany = jest.fn(async (..._args: any[]) => undefined);
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-gap',
        type: 'GAP_CHECK',
        dedupeKey: 'gap-check',
        payload: {},
      }),
    );
    expect(m.jobs.enqueueMany).toHaveBeenCalledTimes(1);
    const inputs = m.jobs.enqueueMany.mock.calls[0]![0] as Array<{
      type: string;
      payload: { animeId: string };
    }>;
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.payload.animeId).toBe('g1');
    expect(inputs[1]!.payload.animeId).toBe('i1');
    expect(m.jobs.complete).toHaveBeenCalledWith('job-gap', '');
  });

  it('process GAP_CHECK com gaps vazios enfileira apenas incompletos', async () => {
    m.prisma.$queryRaw = jest.fn(async () => []) as any;
    m.prisma.anime.findMany = jest.fn(async () => [
      {
        id: 'i1',
        slug: 'incomplete',
        episodeCount: 2,
        _count: { episodes: 1 },
      },
    ]) as any;
    m.jobs.enqueueMany = jest.fn(async (..._args: any[]) => undefined);
    const worker = makeWorker();
    await worker.process(
      job({
        id: 'job-gap2',
        type: 'GAP_CHECK',
        dedupeKey: 'gap-check',
        payload: {},
      }),
    );
    expect(m.jobs.enqueueMany.mock.calls[0]![0]).toHaveLength(1);
  });
});
