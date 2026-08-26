import { WorkerService } from '@/watchtower/worker.service';
import { probeMediaUrlDead } from '@/common/media-probe';

jest.mock('@/common/media-probe', () => ({
  probeMediaUrlDead: jest.fn(),
}));

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
      episode: {
        findUnique: jest.fn(async (args: any) => {
          // Segundo lookup por id (só videoUrl) simula vídeo morto p/ forçar re-extração.
          if (args?.where?.id) {
            return { id: 'ep3', videoUrl: null };
          }
          if (args?.where?.animeId_season_number?.number === 3) {
            return {
              id: 'ep3',
              animeId: 'anime-1',
              number: 3,
              embedUrl: 'https://meusanimes.blog/e/solo-2-episodio-3/',
            };
          }
          return {
            id: 'ep1',
            animeId: 'anime-1',
            number: 1,
            videoUrl: 'old.mp4',
            embedUrl: 'https://meusanimes.blog/e/solo/',
          };
        }),
        update: jest.fn(async () => undefined),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      $queryRaw: jest.fn(async () => []),
    },
    jobs: {
      complete: jest.fn(async () => undefined),
      fail: jest.fn(async () => undefined),
      enqueueMany: jest.fn(async (..._args: any[]) => undefined),
      reschedule: jest.fn(async () => true),
    },
    extractor: {
      extract: jest.fn(
        async (
          _slug: string,
          _ep: number,
          _season?: number,
          _episodeUrl?: string,
        ) => ({
          candidates: [
            {
              videoUrl: 'new.mp4',
              sourceId: 'meusanimes',
              embedUrl: 'https://meusanimes.blog/e/solo/',
            },
          ],
          triedSources: ['meusanimes'],
        }),
      ),
    },
    validator: {
      pickValid: jest.fn(async (cands: any[]) => cands[0] ?? null),
    },
    publisher: {
      publish: jest.fn(async () => undefined),
      markAnimeComplete: jest.fn(async () => undefined),
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
    health: {
      reviveOne: jest.fn(async () => null),
      recordFailure: jest.fn(async () => undefined),
    },
    catalog: {
      scanAll: jest.fn(async () => ({ scanned: 0, enqueued: 0 })),
      processScanCatalog: jest.fn(async () => ({ found: 0, missing: 0 })),
    },
    schedule: {
      backfillAnilist: jest.fn(async () => 0),
      syncSchedules: jest.fn(),
    },
  };
}

let m = makeMocks();

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
  it('process EXTRACT_EPISODE sucesso: extract → validate → publish → complete', async () => {
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-1',
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:anime-1:1',
        payload: { animeId: 'anime-1', slug: 'solo', episodeNumber: 1 },
      }),
    );
    expect(m.extractor.extract).toHaveBeenCalledWith('solo', 1, 1, undefined);
    expect(m.validator.pickValid).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ videoUrl: 'new.mp4' }),
      ]),
      'anime-1',
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        animeId: 'anime-1',
        episodeNumber: 1,
        videoUrl: 'new.mp4',
        sourceId: 'meusanimes',
        // embedUrl vem do candidato que produziu o vídeo (URL real do catálogo),
        // não do template construído — preserva URLs de filmes (/e/<slug>/).
        embedUrl: 'https://meusanimes.blog/e/solo/',
      }),
    );
    expect(m.jobs.complete).toHaveBeenCalledWith('job-1', '');
  });

  it('process EXTRACT_EPISODE falha quando extractor não acha fonte', async () => {
    m.extractor.extract.mockResolvedValueOnce({
      candidates: [],
      triedSources: [],
    });
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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

  it('process BACKFILL_ANILIST delega para schedule.backfillAnilist', async () => {
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-ba',
        type: 'BACKFILL_ANILIST',
        dedupeKey: 'backfill-anilist',
        payload: {},
      }),
    );
    expect(m.schedule.backfillAnilist).toHaveBeenCalledTimes(1);
    expect(m.jobs.complete).toHaveBeenCalledWith('job-ba', '');
  });

  it('process SYNC_SCHEDULES delega para schedule.syncSchedules e completa quando página termina', async () => {
    m.schedule.syncSchedules.mockResolvedValueOnce({
      synced: 5,
      continued: false,
      nextAfterId: null,
    });
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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

  it('lançamento de erro em extract → jobs.fail', async () => {
    m.extractor.extract.mockRejectedValueOnce(new Error('crash'));
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-5',
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:anime-1:1',
        payload: { animeId: 'anime-1', slug: 'solo', episodeNumber: 1 },
      }),
    );
    expect(m.jobs.fail).toHaveBeenCalledWith('job-5', '', 'crash');
  });

  it('process REPAIR_EPISODE reextrai usando o embedUrl existente do episódio', async () => {
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-repair',
        type: 'REPAIR_EPISODE',
        dedupeKey: 'repair:anime-1:1:3',
        payload: { animeId: 'anime-1', episodeNumber: 3 },
      }),
    );
    // O repair deve passar o embedUrl real do episódio (não o template por slug base)
    expect(m.extractor.extract).toHaveBeenCalledWith(
      'solo',
      3,
      1,
      'https://meusanimes.blog/e/solo-2-episodio-3/',
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        animeId: 'anime-1',
        episodeNumber: 3,
        videoUrl: 'new.mp4',
      }),
    );
    expect(m.jobs.complete).toHaveBeenCalledWith('job-repair', '');
  });

  it('process SYNC_AIRING delega para release.checkAll', async () => {
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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
    // gap g1 + incompleto i1
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
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
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

  it('process EXTRACT_EPISODE lança fail quando anime não existe', async () => {
    m.prisma.anime.findUnique = jest.fn(async () => null) as any;
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-noanime',
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:ghost:1',
        payload: { animeId: 'ghost', slug: 'ghost', episodeNumber: 1 },
      }),
    );
    expect(m.extractor.extract).not.toHaveBeenCalled();
    expect(m.jobs.fail).toHaveBeenCalledWith(
      'job-noanime',
      '',
      expect.stringContaining('não encontrado'),
    );
  });

  it('process EXTRACT_EPISODE marca vídeo quebrado quando validação falha', async () => {
    m.validator.pickValid = jest.fn(async () => null) as any;
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-inv',
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:anime-1:1',
        payload: { animeId: 'anime-1', slug: 'solo', episodeNumber: 1 },
      }),
    );
    expect(m.health.recordFailure).toHaveBeenCalledWith('meusanimes');
    expect(m.prisma.episode.updateMany).toHaveBeenCalled();
    expect(m.jobs.fail).toHaveBeenCalledWith(
      'job-inv',
      '',
      expect.stringContaining('Validação falhou'),
    );
  });

  it('process EXTRACT_EPISODE usa embedUrl template quando candidato não tem embedUrl', async () => {
    m.extractor.extract.mockResolvedValueOnce({
      candidates: [{ videoUrl: 'new.mp4', sourceId: 'animefire' }],
      triedSources: ['animefire'],
    } as any);
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-embed',
        type: 'EXTRACT_EPISODE',
        dedupeKey: 'extract:anime-1:1',
        payload: { animeId: 'anime-1', slug: 'solo', episodeNumber: 1 },
      }),
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        embedUrl: 'https://animefire.io/animes/solo/1',
        thumbnailUrl: 'cover.jpg',
        title: 'Episódio 1',
      }),
    );
    expect(m.jobs.complete).toHaveBeenCalledWith('job-embed', '');
  });

  it('process REPAIR_EPISODE reextrai como EXTRACT quando episódio não existe', async () => {
    m.prisma.episode.findUnique = jest.fn(async () => null) as any;
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-repair-miss',
        type: 'REPAIR_EPISODE',
        dedupeKey: 'repair:anime-1:1:9',
        payload: { animeId: 'anime-1', episodeNumber: 9 },
      }),
    );
    expect(m.extractor.extract).toHaveBeenCalledWith('solo', 9, 1, undefined);
    expect(m.publisher.publish).toHaveBeenCalled();
    expect(m.jobs.complete).toHaveBeenCalledWith('job-repair-miss', '');
  });

  it('process REPAIR_EPISODE lança fail quando anime não existe', async () => {
    m.prisma.anime.findUnique = jest.fn(async () => null) as any;
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-repair-noanime',
        type: 'REPAIR_EPISODE',
        dedupeKey: 'repair:anime-1:1:3',
        payload: { animeId: 'anime-1', episodeNumber: 3 },
      }),
    );
    expect(m.jobs.fail).toHaveBeenCalledWith(
      'job-repair-noanime',
      '',
      expect.stringContaining('não encontrado'),
    );
  });

  it('process REPAIR_EPISODE mantém vídeo vivo quando probe retorna false', async () => {
    (probeMediaUrlDead as jest.Mock).mockResolvedValueOnce(false);
    m.prisma.episode.findUnique = jest.fn(async (args: any) => {
      if (args?.where?.id) return { id: 'ep1', videoUrl: 'alive.mp4' };
      return {
        id: 'ep1',
        animeId: 'anime-1',
        number: 1,
        embedUrl: 'https://meusanimes.blog/e/solo/',
      };
    }) as any;
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-repair-alive',
        type: 'REPAIR_EPISODE',
        dedupeKey: 'repair:anime-1:1:1',
        payload: { animeId: 'anime-1', episodeNumber: 1 },
      }),
    );
    expect(probeMediaUrlDead).toHaveBeenCalledWith('alive.mp4');
    expect(m.prisma.episode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ videoBroken: false }),
      }),
    );
    expect(m.extractor.extract).not.toHaveBeenCalled();
    expect(m.jobs.complete).toHaveBeenCalledWith('job-repair-alive', '');
  });

  it('process REPAIR_EPISODE lança fail quando extractor não acha fonte', async () => {
    m.extractor.extract.mockResolvedValueOnce({
      candidates: [],
      triedSources: [],
    });
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-repair-nosrc',
        type: 'REPAIR_EPISODE',
        dedupeKey: 'repair:anime-1:1:3',
        payload: { animeId: 'anime-1', episodeNumber: 3 },
      }),
    );
    expect(m.jobs.fail).toHaveBeenCalledWith(
      'job-repair-nosrc',
      '',
      expect.stringContaining('Repair: sem fonte'),
    );
  });

  it('process REPAIR_EPISODE lança fail quando validação falha', async () => {
    m.validator.pickValid = jest.fn(async () => null) as any;
    const worker = new WorkerService(
      m.prisma as any,
      m.jobs as any,
      m.extractor as any,
      m.validator as any,
      m.publisher as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
      m.schedule as any,
    );
    await worker.process(
      job({
        id: 'job-repair-inv',
        type: 'REPAIR_EPISODE',
        dedupeKey: 'repair:anime-1:1:3',
        payload: { animeId: 'anime-1', episodeNumber: 3 },
      }),
    );
    expect(m.jobs.fail).toHaveBeenCalledWith(
      'job-repair-inv',
      '',
      expect.stringContaining('Repair: validação falhou'),
    );
  });
});
