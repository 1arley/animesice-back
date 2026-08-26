import { AniListClient } from './anilist-client.service';

describe('AniListClient', () => {
  let client: AniListClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new AniListClient();
    global.fetch = jest.fn();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('fetchMedia', () => {
    it('retorna dados de mídia do AniList', async () => {
      const mockData = {
        data: {
          Media: {
            id: 12345,
            title: { romaji: 'Test', english: 'Test EN', native: null },
            description: 'desc',
          },
        },
      };
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData),
      });

      const result = await client.fetchMedia(12345);
      expect(result.id).toBe(12345);
      expect(result.title.romaji).toBe('Test');
    });

    it('lança erro quando resposta tem errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          errors: [{ message: 'Not found' }],
        }),
      });

      await expect(client.fetchMedia(99999)).rejects.toThrow('Not found');
    });

    it('lança erro quando data é null', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({ data: null }),
      });

      await expect(client.fetchMedia(1)).rejects.toThrow('resposta vazia');
    });
  });

  describe('airingSchedule', () => {
    it('retorna lista de episódios com airingAt', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: {
            Media: {
              airingSchedule: {
                nodes: [
                  { airingAt: 1700000000, episode: 1 },
                  { airingAt: 1700604800, episode: 2 },
                ],
              },
            },
          },
        }),
      });

      const result = await client.airingSchedule(12345);
      expect(result).toHaveLength(2);
      expect(result[0]!.episode).toBe(1);
    });
  });

  describe('mediaSchedule', () => {
    it('retorna status, datas e schedule', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: {
            Media: {
              status: 'FINISHED',
              startDate: { year: 2024, month: 1, day: 5 },
              endDate: { year: 2024, month: 3, day: 28 },
              airingSchedule: {
                nodes: [{ airingAt: 1700000000, episode: 12 }],
              },
            },
          },
        }),
      });

      const result = await client.mediaSchedule(12345);
      expect(result.status).toBe('FINISHED');
      expect(result.startDate?.year).toBe(2024);
      expect(result.schedule).toHaveLength(1);
    });
  });

  describe('searchMedia', () => {
    it('retorna a primeira mídia encontrada', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: {
            Page: {
              media: [{ id: 111, title: { romaji: 'Found' } }],
            },
          },
        }),
      });

      const result = await client.searchMedia('test');
      expect(result?.id).toBe(111);
    });

    it('retorna null quando não encontra', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: { Page: { media: [] } },
        }),
      });

      const result = await client.searchMedia('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('seasonMedia', () => {
    it('retorna mídia da temporada com hasNext', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: {
            Page: {
              pageInfo: { hasNextPage: true },
              media: [{ id: 1, title: { romaji: 'A' } }],
            },
          },
        }),
      });

      const result = await client.seasonMedia('WINTER', 2024);
      expect(result.media).toHaveLength(1);
      expect(result.hasNext).toBe(true);
    });

    it('retorna hasNext false na última página', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: {
            Page: {
              pageInfo: { hasNextPage: false },
              media: [],
            },
          },
        }),
      });

      const result = await client.seasonMedia('FALL', 2023, 5, 25);
      expect(result.hasNext).toBe(false);
    });
  });
});
