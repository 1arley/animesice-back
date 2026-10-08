import { AnimesonlineScrapeSource } from './animesonline.source';
import { fetchSafeRaw } from '@/common/ssrf';
import { probeMediaUrlDead } from '@/common/media-probe';
import { runRustScraper } from './rust-scraper';
import type { Dispatcher } from 'undici';

jest.mock('@/common/ssrf', () => ({
  fetchSafeRaw: jest.fn(),
}));

jest.mock('./rust-scraper', () => ({
  runRustScraper: jest.fn(),
}));

jest.mock('@/common/media-probe', () => ({
  probeMediaUrlDead: jest.fn(async () => false),
}));

jest.mock('./extract', () => ({
  extractVideoElements: jest.fn(),
  extractAllIframes: jest.fn(),
  keepVideoUrls: jest.fn((urls: string[]) => urls),
}));

const mockedFetchSafeRaw = fetchSafeRaw as jest.MockedFunction<
  typeof fetchSafeRaw
>;
const mockedProbe = probeMediaUrlDead as jest.MockedFunction<
  typeof probeMediaUrlDead
>;
const mockedRunRustScraper = runRustScraper as jest.MockedFunction<
  typeof runRustScraper
>;

function mockFetch(body: string, status = 200): Dispatcher {
  const dispatcher = {
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Dispatcher;
  mockedFetchSafeRaw.mockResolvedValue({
    response: {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    } as Response,
    dispatcher,
  });
  return dispatcher;
}

const EPISODE_URL =
  'https://animesonline.cloud/episodio/ao-no-hako-episodio-23';

const HTML = `
  <video class="animeq-player__video" controls preload="metadata">
    <source src="https://cld.pt/dl/download/x/Ao%20no%20Hako%20%E2%80%93%20Epis%C3%B3dio%2023.mp4" type="video/mp4">
    <source src="https://animeflix.blog/Animes/Letra-A/Ao%20no%20Hako/23.mp4" type="video/mp4">
  </video>
  <iframe class="animeq-player__iframe" src="https://www.blogger.com/video.g?token=abc123" title="SD"></iframe>
  <iframe class="animeq-player__iframe" src="https://animeshd.cloud/#n8tttk" title="FHD"></iframe>
`;

describe('AnimesonlineScrapeSource', () => {
  let source: AnimesonlineScrapeSource;

  beforeEach(() => {
    source = new AnimesonlineScrapeSource();
    mockedFetchSafeRaw.mockReset();
    mockedProbe.mockReset();
    mockedProbe.mockResolvedValue(false);
    mockedRunRustScraper.mockReset();
    delete process.env.ANIMESONLINE_RUST_BIN;
    delete process.env.ANIMESONLINE_RUST_MODE;
  });

  it('usa o binário Rust quando ANIMESONLINE_RUST_BIN está setado', async () => {
    process.env.ANIMESONLINE_RUST_BIN = '/bin/rust';
    mockedRunRustScraper.mockResolvedValue({
      videos: ['https://animeflix.blog/Animes/rust/1.mp4'],
      iframes: [],
      cloudflare: false,
      playerTokens: ['https://www.blogger.com/video.g?token=rust'],
    });
    const ctx = { episodeUrl: EPISODE_URL, ua: 'UA' };
    await expect(source.extractHttp(ctx)).resolves.toMatchObject({
      videos: ['https://animeflix.blog/Animes/rust/1.mp4'],
      playerTokens: ['https://www.blogger.com/video.g?token=rust'],
    });
    expect(mockedRunRustScraper).toHaveBeenCalledWith('/bin/rust', ctx);
    expect(mockedFetchSafeRaw).not.toHaveBeenCalled();
  });

  it('trata MODE=shadow: Rust só loga e o Node resolve', async () => {
    process.env.ANIMESONLINE_RUST_BIN = '/bin/rust';
    process.env.ANIMESONLINE_RUST_MODE = 'shadow';
    mockedRunRustScraper.mockResolvedValue({
      videos: ['https://animeflix.blog/Animes/shadow/rust.mp4'],
      iframes: [],
      cloudflare: false,
      playerTokens: [],
    });
    mockFetch('<source src="https://animeflix.blog/Animes/shadow/node.mp4">');
    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'UA' }),
    ).resolves.toMatchObject({
      videos: ['https://animeflix.blog/Animes/shadow/node.mp4'],
    });
    expect(mockedRunRustScraper).toHaveBeenCalled();
  });

  it('cai para o Node quando o Rust devolve vazio', async () => {
    process.env.ANIMESONLINE_RUST_BIN = '/bin/rust';
    mockedRunRustScraper.mockResolvedValue({
      videos: [],
      iframes: [],
      cloudflare: false,
      playerTokens: [],
    });
    mockFetch('<source src="https://animeflix.blog/Animes/fallback/node.mp4">');
    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'UA' }),
    ).resolves.toMatchObject({
      videos: ['https://animeflix.blog/Animes/fallback/node.mp4'],
    });
  });

  it('reconhece URLs do animesonline.cloud e ignora outras', () => {
    expect(source.supports(EPISODE_URL)).toBe(true);
    expect(source.supports('https://animesonline.cloud/anime/ao-no-hako')).toBe(
      true,
    );
    expect(source.supports('https://www.animesonline.cloud/x')).toBe(true);
    expect(
      source.supports('https://animesonline.lat/watch/unified-x-ep-1'),
    ).toBe(false);
    expect(source.supports('https://animefire.io/animes/x/1')).toBe(false);
  });

  it('devolve só os .mp4 vivos e o token Blogger (ignora iframe de terceiros)', async () => {
    const dispatcher = mockFetch(HTML);
    mockedProbe.mockImplementation(async (url: string) =>
      url.includes('cld.pt'),
    );

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'UA' }),
    ).resolves.toEqual({
      videos: ['https://animeflix.blog/Animes/Letra-A/Ao%20no%20Hako/23.mp4'],
      iframes: [],
      cloudflare: false,
      playerTokens: ['https://www.blogger.com/video.g?token=abc123'],
    });
    expect(dispatcher.close).toHaveBeenCalled();
    expect(mockedProbe).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('sem candidata viva devolve só o player token (fluxo Playwright)', async () => {
    mockFetch(HTML);
    mockedProbe.mockResolvedValue(true);

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: 'UA',
    });
    expect(result.videos).toEqual([]);
    expect(result.playerTokens).toEqual([
      'https://www.blogger.com/video.g?token=abc123',
    ]);
  });

  it('página sem fonte nenhuma devolve resultado vazio (failure no service)', async () => {
    mockFetch('<html><body>Sem player</body></html>');

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'UA' }),
    ).resolves.toEqual({
      videos: [],
      iframes: [],
      cloudflare: false,
      playerTokens: [],
    });
  });

  it('encapsula falha HTTP e fecha dispatcher', async () => {
    const dispatcher = mockFetch('erro', 500);
    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'UA' }),
    ).rejects.toThrow(`animesonline: ${EPISODE_URL} retornou 500`);
    expect(dispatcher.close).toHaveBeenCalled();

    mockedFetchSafeRaw.mockRejectedValueOnce(new Error('offline'));
    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'UA' }),
    ).rejects.toThrow('animesonline: fetch failed');
  });

  it('usa helpers no fallback Playwright', async () => {
    const helpers = jest.requireMock('./extract');
    helpers.extractVideoElements.mockResolvedValue([
      'https://animeflix.blog/23.mp4',
    ]);
    helpers.extractAllIframes.mockResolvedValue([
      'https://www.blogger.com/video.g?token=abc',
    ]);

    await expect(source.extract({} as never)).resolves.toEqual({
      videos: ['https://animeflix.blog/23.mp4'],
      iframes: ['https://www.blogger.com/video.g?token=abc'],
      cloudflare: false,
    });
  });
});
