import { AnimesonlineccScrapeSource } from './animesonlinecc.source';

jest.mock('./extract', () => {
  const actual = jest.requireActual('./extract');
  return {
    keepVideoUrls: actual.keepVideoUrls,
    extractVideoElements: jest.fn(),
    extractAllIframes: jest.fn(),
  };
});

describe('AnimesonlineccScrapeSource', () => {
  let source: AnimesonlineccScrapeSource;

  beforeEach(() => {
    source = new AnimesonlineccScrapeSource();
    jest.clearAllMocks();
  });

  describe('supports', () => {
    it('reconhece hosts animesonlinecc.*', () => {
      expect(
        source.supports('https://animesonlinecc.to/episodio/foo-episodio-1/'),
      ).toBe(true);
      expect(source.supports('https://animesonlinecc.tv/episodio/x/')).toBe(
        true,
      );
      expect(source.supports('https://animefire.io/x')).toBe(false);
    });
  });

  describe('extract', () => {
    it('prioriza iframes de player (Blogger/YouTube/embed) antes dos demais', async () => {
      const extractHelpers = jest.requireMock('./extract');
      extractHelpers.extractVideoElements.mockResolvedValue([
        'https://cdn.test/v.mp4',
        'https://cdn.test/v.m3u8',
      ]);
      extractHelpers.extractAllIframes.mockResolvedValue([
        'https://ad.test/banner',
        'https://www.blogger.com/video.g?token=abc',
        'https://www.youtube.com/embed/dQw4w9WgXcQ',
        'https://serv.example/player/123',
      ]);

      const result = await source.extract({} as never);

      expect(result.videos).toEqual([
        'https://cdn.test/v.mp4',
        'https://cdn.test/v.m3u8',
      ]);
      expect(result.iframes[0]).toContain('blogger.com/video');
      expect(result.iframes[1]).toContain('youtube.com/embed');
      expect(result.iframes[2]).toContain('player');
      expect(result.iframes[3]).toBe('https://ad.test/banner');
      expect(result.cloudflare).toBe(false);
    });

    it('retorna arrays vazios quando não há vídeo nem iframe', async () => {
      const extractHelpers = jest.requireMock('./extract');
      extractHelpers.extractVideoElements.mockResolvedValue([]);
      extractHelpers.extractAllIframes.mockResolvedValue([]);

      const result = await source.extract({} as never);
      expect(result.videos).toEqual([]);
      expect(result.iframes).toEqual([]);
    });

    it('mantém apenas URLs .mp4/.m3u8 de vídeo', async () => {
      const extractHelpers = jest.requireMock('./extract');
      extractHelpers.extractVideoElements.mockResolvedValue([
        'blob:https://animesonlinecc.to/abc',
        'https://cdn.test/ep.m3u8',
      ]);
      extractHelpers.extractAllIframes.mockResolvedValue([
        'https://www.youtube.com/embed/abcDEFghi12',
      ]);

      const result = await source.extract({} as never);
      expect(result.videos).toEqual(['https://cdn.test/ep.m3u8']);
      expect(result.iframes).toEqual([
        'https://www.youtube.com/embed/abcDEFghi12',
      ]);
    });
  });
});
