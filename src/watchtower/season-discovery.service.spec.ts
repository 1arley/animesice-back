import { SeasonDiscovery } from './season-discovery.service';
import { JOB_TYPE } from './watchtower.types';

function makeMocks() {
  return {
    prisma: {
      anime: {
        findMany: jest.fn(),
        createMany: jest.fn(),
      },
      genre: {
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      $executeRaw: jest.fn(),
    },
    anilist: {
      seasonMedia: jest.fn(),
      airingSchedule: jest.fn(),
    },
    jobs: {
      enqueueMany: jest.fn(),
    },
  };
}

describe('SeasonDiscovery', () => {
  let m: ReturnType<typeof makeMocks>;
  let discovery: SeasonDiscovery;

  beforeEach(() => {
    m = makeMocks();
    discovery = new SeasonDiscovery(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    jest.restoreAllMocks();
  });

  describe('discover', () => {
    it('retorna 0 quando não há mídia na temporada', async () => {
      m.anilist.seasonMedia.mockResolvedValue({ media: [], hasNext: false });
      m.prisma.anime.findMany.mockResolvedValue([]);
      m.prisma.anime.createMany.mockResolvedValue({ count: 0 });
      const result = await discovery.discover();
      expect(result).toBe(0);
    });

    it('cria animes novos com base nos dados do AniList', async () => {
      m.anilist.seasonMedia.mockResolvedValue({
        media: [
          {
            id: 12345,
            title: { romaji: 'Test Anime', english: null, native: null },
            coverImage: { large: 'cover.jpg', extraLarge: null },
            bannerImage: 'banner.jpg',
            description: 'Test description',
            averageScore: 85,
            status: 'FINISHED',
            genres: ['Action', 'Drama'],
            isAdult: false,
            season: 'WINTER',
            seasonYear: 2024,
            format: 'TV',
            episodes: 12,
            studios: {
              nodes: [{ name: 'Studio Test', isAnimationStudio: true }],
            },
          },
        ],
        hasNext: false,
      });
      m.prisma.anime.findMany.mockResolvedValue([]);
      m.prisma.anime.createMany.mockResolvedValue({ count: 1 });
      m.prisma.anime.findMany.mockResolvedValueOnce([]);
      m.prisma.anime.findMany.mockResolvedValueOnce([
        { id: 'new-anime', anilistId: 12345 },
      ]);
      m.prisma.genre.createMany.mockResolvedValue({ count: 2 });
      m.prisma.genre.findMany.mockResolvedValue([
        { id: 'g1', slug: 'action' },
        { id: 'g2', slug: 'drama' },
      ]);
      m.anilist.airingSchedule.mockResolvedValue([]);

      const result = await discovery.discover();
      expect(result).toBe(1);
      expect(m.prisma.anime.createMany).toHaveBeenCalledTimes(1);
    });

    it('pula animes que já existem no catálogo', async () => {
      m.anilist.seasonMedia.mockResolvedValue({
        media: [
          {
            id: 12345,
            title: { romaji: 'Existing Anime', english: null, native: null },
          },
        ],
        hasNext: false,
      });
      m.prisma.anime.findMany.mockResolvedValue([
        { anilistId: 12345, slug: 'existing-anime' },
      ]);
      m.prisma.anime.createMany.mockResolvedValue({ count: 0 });

      const result = await discovery.discover();
      expect(result).toBe(0);
    });

    it('lida com falha na chamada AniList', async () => {
      m.anilist.seasonMedia.mockRejectedValue(new Error('API error'));
      const result = await discovery.discover();
      expect(result).toBe(0);
    });

    it('lida com title fallback para native quando romaji e english são null', async () => {
      m.anilist.seasonMedia.mockResolvedValue({
        media: [
          {
            id: 99999,
            title: { romaji: null, english: null, native: 'テストアニメ' },
            genres: [],
            studios: { nodes: [] },
          },
        ],
        hasNext: false,
      });
      m.prisma.anime.findMany.mockResolvedValue([]);
      m.prisma.anime.createMany.mockResolvedValue({ count: 1 });
      m.prisma.anime.findMany.mockResolvedValueOnce([]);
      m.prisma.anime.findMany.mockResolvedValueOnce([
        { id: 'new-anime', anilistId: 99999 },
      ]);

      const result = await discovery.discover();
      expect(result).toBe(1);
    });

    it('cria genres e links quando mídia tem genres', async () => {
      m.anilist.seasonMedia.mockResolvedValue({
        media: [
          {
            id: 55555,
            title: { romaji: 'Genre Test' },
            genres: ['Action'],
            studios: { nodes: [] },
          },
        ],
        hasNext: false,
      });
      m.prisma.anime.findMany.mockResolvedValue([]);
      m.prisma.anime.createMany.mockResolvedValue({ count: 1 });
      m.prisma.anime.findMany.mockResolvedValueOnce([]);
      m.prisma.anime.findMany.mockResolvedValueOnce([
        { id: 'a1', anilistId: 55555 },
      ]);
      m.prisma.genre.createMany.mockResolvedValue({ count: 1 });
      m.prisma.genre.findMany.mockResolvedValue([{ id: 'g1', slug: 'action' }]);
      m.prisma.$executeRaw.mockResolvedValue(undefined);

      await discovery.discover();
      expect(m.prisma.genre.createMany).toHaveBeenCalled();
      expect(m.prisma.$executeRaw).toHaveBeenCalled();
    });

    it('processa múltiplas páginas quando hasNext é true', async () => {
      m.anilist.seasonMedia
        .mockResolvedValueOnce({
          media: [
            { id: 1, title: { romaji: 'Anime1' }, studios: { nodes: [] } },
          ],
          hasNext: true,
        })
        .mockResolvedValueOnce({
          media: [
            { id: 2, title: { romaji: 'Anime2' }, studios: { nodes: [] } },
          ],
          hasNext: false,
        });
      m.prisma.anime.findMany.mockResolvedValue([]);
      m.prisma.anime.createMany.mockResolvedValue({ count: 1 });

      const result = await discovery.discover();
      expect(result).toBe(2);
      expect(m.anilist.seasonMedia).toHaveBeenCalledTimes(2);
    });

    it('enfileira jobs de extração para episódios que já foram ao ar', async () => {
      const now = Math.floor(Date.now() / 1000) - 1000;
      m.anilist.seasonMedia.mockResolvedValue({
        media: [
          {
            id: 77777,
            title: { romaji: 'Airing Anime' },
            studios: { nodes: [] },
          },
        ],
        hasNext: false,
      });
      m.prisma.anime.findMany.mockResolvedValue([]);
      m.prisma.anime.createMany.mockResolvedValue({ count: 1 });
      m.prisma.anime.findMany.mockResolvedValueOnce([]);
      m.prisma.anime.findMany.mockResolvedValueOnce([
        { id: 'a1', anilistId: 77777 },
      ]);
      m.anilist.airingSchedule.mockResolvedValue([
        { airingAt: now, episode: 1 },
        { airingAt: now + 604800, episode: 2 },
      ]);
      m.jobs.enqueueMany.mockResolvedValue(undefined);

      await discovery.discover();
      expect(m.jobs.enqueueMany).toHaveBeenCalled();
      const jobs = m.jobs.enqueueMany.mock.calls[0][0];
      expect(jobs.length).toBe(1);
      expect(jobs[0].type).toBe(JOB_TYPE.EXTRACT_EPISODE);
    });

    it('lida com falha no airingSchedule de forma silenciosa', async () => {
      m.anilist.seasonMedia.mockResolvedValue({
        media: [
          {
            id: 88888,
            title: { romaji: 'Fail Schedule' },
            studios: { nodes: [] },
          },
        ],
        hasNext: false,
      });
      m.prisma.anime.findMany.mockResolvedValue([]);
      m.prisma.anime.createMany.mockResolvedValue({ count: 1 });
      m.prisma.anime.findMany.mockResolvedValueOnce([]);
      m.prisma.anime.findMany.mockResolvedValueOnce([
        { id: 'a1', anilistId: 88888 },
      ]);
      m.anilist.airingSchedule.mockRejectedValue(new Error('schedule error'));
      m.jobs.enqueueMany.mockResolvedValue(undefined);

      const result = await discovery.discover();
      expect(result).toBe(1);
    });

    it('filtra studios vazios', async () => {
      m.anilist.seasonMedia.mockResolvedValue({
        media: [
          {
            id: 11111,
            title: { romaji: 'No Studios' },
            studios: { nodes: [{ name: '' }] },
          },
        ],
        hasNext: false,
      });
      m.prisma.anime.findMany.mockResolvedValue([]);
      m.prisma.anime.createMany.mockResolvedValue({ count: 1 });

      const result = await discovery.discover();
      expect(result).toBe(1);
      const data = m.prisma.anime.createMany.mock.calls[0][0].data[0];
      expect(data.studios).toEqual([]);
    });
  });
});
