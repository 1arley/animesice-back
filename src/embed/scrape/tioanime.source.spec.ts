import { TioanimeScrapeSource } from './tioanime.source';
import { fetchSafeRaw } from '@/common/ssrf';
import { Dispatcher } from 'undici';

jest.mock('@/common/ssrf', () => ({
  fetchSafeRaw: jest.fn(),
}));

jest.mock('./extract', () => ({
  extractVideoElements: jest.fn(),
  extractAllIframes: jest.fn(),
  keepVideoUrls: jest.fn((urls: string[]) =>
    urls.filter((url) => url.includes('.mp')),
  ),
}));

const mockedFetchSafeRaw = fetchSafeRaw as jest.MockedFunction<
  typeof fetchSafeRaw
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

describe('TioanimeScrapeSource', () => {
  let source: TioanimeScrapeSource;

  beforeEach(() => {
    source = new TioanimeScrapeSource();
    mockedFetchSafeRaw.mockReset();
  });

  it('reconhece URLs e cria URL de episódio', () => {
    expect(source.supports('https://tioanime.com/ver/x-1')).toBe(true);
    expect(source.supports('https://www.tioanime.com/ver/x-1')).toBe(true);
    expect(source.supports('https://animefire.io/x')).toBe(false);
    expect(source.episodeUrl('one-piece', 12)).toBe(
      'https://tioanime.com/ver/one-piece-12',
    );
  });

  it('separa vídeos diretos e tokens sem duplicar', async () => {
    const dispatcher = mockFetch(`var videos = [
      ["MP4","https:\\/\\/cdn.test\\/video.mp4",0,0],
      ["HLS","https:\\/\\/cdn.test\\/video.m3u8",0,0],
      ["Embed","https:\\/\\/embedsb.com\\/e\\/id",0,0],
      ["Outro","https:\\/\\/mega.test\\/id",0,0],
      ["Duplicado","https:\\/\\/cdn.test\\/video.mp4",0,0]
    ];`);

    await expect(
      source.extractHttp({
        episodeUrl: 'https://tioanime.com/ver/x-1',
        ua: 'UA',
      }),
    ).resolves.toEqual({
      videos: ['https://cdn.test/video.mp4', 'https://cdn.test/video.m3u8'],
      iframes: [],
      cloudflare: false,
      playerTokens: ['https://embedsb.com/e/id', 'https://mega.test/id'],
    });
    expect(dispatcher.close).toHaveBeenCalled();
  });

  it.each([
    ['sem videos', 'tioanime: var videos nao encontrado'],
    ['var videos = invalido;', 'tioanime: var videos nao encontrado'],
    ['var videos = [];', 'tioanime: array de videos vazio'],
    ['var videos = [invalido];', 'tioanime: falha ao parsear JSON'],
  ])('rejeita HTML inválido: %s', async (html, message) => {
    mockFetch(html);
    await expect(
      source.extractHttp({
        episodeUrl: 'https://tioanime.com/ver/x-1',
        ua: 'UA',
      }),
    ).rejects.toThrow(message);
  });

  it('encapsula falha HTTP e fecha dispatcher em resposta inválida', async () => {
    const dispatcher = mockFetch('erro', 500);
    await expect(
      source.extractHttp({
        episodeUrl: 'https://tioanime.com/ver/x-1',
        ua: 'UA',
      }),
    ).rejects.toThrow('tioanime: https://tioanime.com/ver/x-1 retornou 500');
    expect(dispatcher.close).toHaveBeenCalled();

    mockedFetchSafeRaw.mockRejectedValueOnce('offline');
    await expect(
      source.extractHttp({
        episodeUrl: 'https://tioanime.com/ver/x-1',
        ua: 'UA',
      }),
    ).rejects.toThrow('tioanime: fetch failed');
  });

  it('usa helpers no fallback Playwright', async () => {
    const helpers = jest.requireMock('./extract');
    helpers.extractVideoElements.mockResolvedValue(['https://cdn.test/v.mp4']);
    helpers.extractAllIframes.mockResolvedValue(['https://embed.test/player']);
    helpers.keepVideoUrls.mockReturnValue(['https://cdn.test/v.mp4']);

    await expect(source.extract({} as never)).resolves.toEqual({
      videos: ['https://cdn.test/v.mp4'],
      iframes: ['https://embed.test/player'],
      cloudflare: false,
    });
  });
});
