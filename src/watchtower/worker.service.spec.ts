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
      },
      episode: {
        findUnique: jest.fn(async () => ({
          id: 'ep1',
          animeId: 'anime-1',
          number: 1,
          videoUrl: 'old.mp4',
        })),
        update: jest.fn(async () => undefined),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    },
    jobs: {
      complete: jest.fn(async () => undefined),
      fail: jest.fn(async () => undefined),
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
  };
}

const m = makeMocks();

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
});
