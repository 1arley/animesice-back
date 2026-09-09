import { AdultCatalogSyncService } from './adult-catalog-sync.service';

const mockSourceFindMany = jest.fn();
const mockSourceDisconnect = jest.fn(async () => undefined);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    anime: { findMany: mockSourceFindMany },
    $disconnect: mockSourceDisconnect,
  })),
}));

function srcAnime(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'h-anime',
    title: 'H Anime',
    synopsis: 'sinopse',
    coverImage: 'cover.jpg',
    bannerImage: null,
    rating: 7.5,
    status: 'COMPLETED',
    audio: 'LEGENDADO',
    format: 'TV',
    year: 2024,
    season: 'WINTER',
    studios: ['Studio'],
    themes: ['school'],
    alternativeTitles: ['H Anime Alt'],
    japaneseTitle: 'H アニメ',
    source: 'original',
    releaseDate: null,
    endDate: null,
    episodeCount: 1,
    published: true,
    genres: [{ slug: 'romance', name: 'Romance' }],
    episodes: [
      {
        season: 1,
        number: 1,
        title: 'Ep 1',
        thumbnailUrl: null,
        videoUrl: 'https://cdn/video.mp4',
        embedUrl: null,
        duration: '24:00',
        sourceId: 'src-1',
      },
    ],
    ...overrides,
  };
}

function makePrisma() {
  return {
    genre: { upsert: jest.fn(async () => ({})) },
    anime: {
      findUnique: jest.fn(async (): Promise<any> => null),
      upsert: jest.fn(async (args: { create: { slug: string } }) => ({
        id: `id-${args.create.slug}`,
      })),
    },
    episode: { upsert: jest.fn(async () => ({})) },
  };
}

describe('AdultCatalogSyncService', () => {
  const env = process.env;
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdultCatalogSyncService;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...env };
    process.env.ADULT_CATALOG_ENABLED = 'true';
    delete process.env.SITE_MODE;
    process.env.HENTAI_SOURCE_DATABASE_URL = 'postgresql://u:p@localhost/db';
    jest.clearAllMocks();
    prisma = makePrisma();
    service = new AdultCatalogSyncService(prisma as any);
    consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = env;
    consoleError.mockRestore();
  });

  describe('handleCron', () => {
    it('não sincroniza quando o sync está desabilitado', async () => {
      delete process.env.ADULT_CATALOG_ENABLED;
      const sync = jest
        .spyOn(service, 'sync')
        .mockResolvedValue({ imported: 0, updated: 0 });
      await service.handleCron();
      expect(sync).not.toHaveBeenCalled();
    });

    it('não sincroniza em SITE_MODE=hentai', async () => {
      process.env.SITE_MODE = 'hentai';
      const sync = jest
        .spyOn(service, 'sync')
        .mockResolvedValue({ imported: 0, updated: 0 });
      await service.handleCron();
      expect(sync).not.toHaveBeenCalled();
    });

    it('sincroniza quando habilitado', async () => {
      mockSourceFindMany.mockResolvedValue([]);
      await service.handleCron();
      expect(prisma.genre.upsert).toHaveBeenCalled();
    });

    it('sincroniza no bootstrap quando habilitado', async () => {
      const sync = jest
        .spyOn(service, 'sync')
        .mockResolvedValue({ imported: 0, updated: 0 });

      await service.onApplicationBootstrap();

      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('não executa sync concorrente', async () => {
      let release!: () => void;
      const sync = jest.spyOn(service, 'sync').mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ imported: 0, updated: 0 });
          }),
      );

      const first = service.handleCron();
      await service.handleCron();
      release();
      await first;

      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('loga erro quando o sync com Error falha', async () => {
      jest.spyOn(service, 'sync').mockRejectedValue(new Error('boom'));
      await expect(service.handleCron()).resolves.toBeUndefined();
      expect(consoleError).toHaveBeenCalledWith('[ADULT-SYNC] falhou:', 'boom');
    });

    it('loga erro quando o sync falha com valor não-Error', async () => {
      jest.spyOn(service, 'sync').mockRejectedValue('plain');
      await expect(service.handleCron()).resolves.toBeUndefined();
      expect(consoleError).toHaveBeenCalledWith(
        '[ADULT-SYNC] falhou:',
        'plain',
      );
    });
  });

  describe('sync', () => {
    it('retorna zeros com fonte vazia e desconecta', async () => {
      mockSourceFindMany.mockResolvedValue([]);
      const result = await service.sync();
      expect(result).toEqual({ imported: 0, updated: 0 });
      expect(prisma.genre.upsert).toHaveBeenCalledWith({
        where: { slug: 'hentai' },
        update: {},
        create: { slug: 'hentai', name: 'Hentai' },
      });
      expect(mockSourceDisconnect).toHaveBeenCalled();
    });

    it('conta created em dryRun sem tocar no banco de destino', async () => {
      mockSourceFindMany.mockResolvedValue([srcAnime()]);
      const result = await service.sync({ dryRun: true });
      expect(result).toEqual({ imported: 1, updated: 0 });
      expect(prisma.anime.upsert).not.toHaveBeenCalled();
    });

    it('conta updated em dryRun quando o anime já existe', async () => {
      prisma.anime.findUnique.mockResolvedValue({
        ageRating: 'A18',
        genres: [{ slug: 'hentai' }],
      });
      mockSourceFindMany.mockResolvedValue([srcAnime()]);
      const result = await service.sync({ dryRun: true });
      expect(result).toEqual({ imported: 0, updated: 1 });
    });

    it('importa anime novo com episódios', async () => {
      mockSourceFindMany.mockResolvedValue([srcAnime()]);
      const result = await service.sync();
      expect(result).toEqual({ imported: 1, updated: 0 });
      expect(prisma.anime.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.episode.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.episode.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            animeId_season_number: {
              animeId: 'id-h-anime',
              season: 1,
              number: 1,
            },
          },
        }),
      );
    });

    it('renomeia slug em colisão com catálogo não-adulto', async () => {
      prisma.anime.findUnique.mockResolvedValue({
        ageRating: 'L',
        genres: [{ slug: 'romance' }],
      });
      mockSourceFindMany.mockResolvedValue([srcAnime({ episodes: [] })]);
      const result = await service.sync();
      expect(result).toEqual({ imported: 0, updated: 1 });
      expect(prisma.anime.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: 'h-anime-hentai' } }),
      );
      expect(consoleError).toHaveBeenCalledWith(
        '[ADULT-SYNC] slug em colisão, usando h-anime-hentai',
      );
    });

    it('mantém slug quando o existente já é adulto', async () => {
      prisma.anime.findUnique.mockResolvedValue({
        ageRating: 'L',
        genres: [{ slug: 'hentai' }],
      });
      mockSourceFindMany.mockResolvedValue([srcAnime({ episodes: [] })]);
      await service.sync();
      expect(prisma.anime.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: 'h-anime' } }),
      );
    });

    it('respeita limit interrompendo após o primeiro item', async () => {
      mockSourceFindMany.mockResolvedValue([
        srcAnime({ slug: 'a1', episodes: [] }),
        srcAnime({ slug: 'a2', episodes: [] }),
      ]);
      const result = await service.sync({ dryRun: true, limit: 1 });
      expect(result).toEqual({ imported: 1, updated: 0 });
      expect(prisma.anime.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});
