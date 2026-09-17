import { AnimesdigitalScrapeSource } from './animesdigital.source';
import { fetchSafeRaw } from '@/common/ssrf';

jest.mock('@/common/ssrf', () => ({ fetchSafeRaw: jest.fn() }));

describe('AnimesdigitalScrapeSource', () => {
  it('extrai HLS do parâmetro d sem depender do slug AnimeSice', async () => {
    const dispatcher = { close: jest.fn().mockResolvedValue(undefined) };
    (fetchSafeRaw as jest.Mock).mockResolvedValue({
      response: {
        ok: true,
        status: 200,
        text: async () =>
          '<iframe src="https://api.anivideo.net/videohls.php?d=https://cdn.example/witch-watch/1.m3u8"></iframe>',
      },
      dispatcher,
    });
    const source = new AnimesdigitalScrapeSource();
    const result = await source.extractHttp({
      episodeUrl: 'https://animesdigital.org/video/a/138903/',
      ua: 'test',
    });
    expect(result.videos).toEqual(['https://cdn.example/witch-watch/1.m3u8']);
    expect(source.supports('https://animesdigital.org/video/a/138903/')).toBe(
      true,
    );
  });
});
