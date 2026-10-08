import { AnimesdigitalScrapeSource } from './animesdigital.source';
import { fetchSafeRaw } from '@/common/ssrf';
import { runRustScraper } from './rust-scraper';

jest.mock('@/common/ssrf', () => ({ fetchSafeRaw: jest.fn() }));
jest.mock('./rust-scraper', () => ({ runRustScraper: jest.fn() }));

describe('AnimesdigitalScrapeSource', () => {
  it('usa o binário Rust quando ANIMESDIGITAL_RUST_BIN está setado', async () => {
    const source = new AnimesdigitalScrapeSource();
    process.env.ANIMESDIGITAL_RUST_BIN = '/bin/rust';
    (runRustScraper as jest.Mock).mockResolvedValue({
      videos: ['https://cdn.example/hls/rust.m3u8'],
      iframes: [],
      cloudflare: false,
      playerTokens: [],
    });
    const ctx = {
      episodeUrl: 'https://animesdigital.org/video/a/138903/',
      ua: 'test',
    };
    await expect(source.extractHttp(ctx)).resolves.toMatchObject({
      videos: ['https://cdn.example/hls/rust.m3u8'],
    });
    expect(runRustScraper).toHaveBeenCalledWith('/bin/rust', ctx);
    expect(fetchSafeRaw).not.toHaveBeenCalled();
    delete process.env.ANIMESDIGITAL_RUST_BIN;
  });

  it('cai para o Node quando o Rust falha', async () => {
    const source = new AnimesdigitalScrapeSource();
    process.env.ANIMESDIGITAL_RUST_BIN = '/bin/rust';
    (runRustScraper as jest.Mock).mockRejectedValue(new Error('boom'));
    (fetchSafeRaw as jest.Mock).mockResolvedValue({
      response: {
        ok: true,
        status: 200,
        text: async () =>
          '<iframe src="https://api.anivideo.net/videohls.php?d=https://cdn.example/node.m3u8"></iframe>',
      },
      dispatcher: { close: jest.fn().mockResolvedValue(undefined) },
    });
    await expect(
      source.extractHttp({
        episodeUrl: 'https://animesdigital.org/video/a/1/',
        ua: 'test',
      }),
    ).resolves.toMatchObject({ videos: ['https://cdn.example/node.m3u8'] });
    delete process.env.ANIMESDIGITAL_RUST_BIN;
  });
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
