import { TopanimesScrapeSource } from './topanimes.source';
import { fetchSafeRaw } from '@/common/ssrf';
import { probeMediaUrlDead } from '@/common/media-probe';
import type { Dispatcher } from 'undici';

jest.mock('@/common/ssrf', () => ({
  fetchSafeRaw: jest.fn(),
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

const UA = 'ua';

/** Enfileira respostas na ordem em que o adapter vai pedir. */
function queueFetch(...responses: { body: string; status?: number }[]): void {
  let i = 0;
  mockedFetchSafeRaw.mockImplementation(async () => {
    const next = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    const dispatcher = {
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as Dispatcher;
    const status = next.status ?? 200;
    return {
      response: {
        ok: status >= 200 && status < 300,
        status,
        text: async () => next.body,
        body: { cancel: jest.fn().mockResolvedValue(undefined) },
      } as unknown as Response,
      dispatcher,
    };
  });
}

const EPISODE_URL = 'https://topanimes.net/episodio/black-clover-episodio-1/';

const HLS_HTML = `
  <iframe class='metaframe rptss' src='https://sk-api.alibabacdn.net/?id=hKQr7WDgMEBe4uEbU3CNU-Black-Clover/1&img=https://image.tmdb.org/t/p/original/x.jpg'></iframe>
`;

const BLOGGER_HTML = `
  <iframe class='metaframe rptss' src='https://www.blogger.com/video.g?token=AD6v5dyGqQRTgspPq3ARl1yPAtmIn6c5JsuDLalrBA15V5v5Lp1KpVp'></iframe>
`;

describe('TopanimesScrapeSource', () => {
  let source: TopanimesScrapeSource;

  beforeEach(() => {
    jest.clearAllMocks();
    source = new TopanimesScrapeSource();
  });

  it('supports() só aceita hosts topanimes.net', () => {
    expect(
      source.supports('https://topanimes.net/episodio/x-episodio-1/'),
    ).toBe(true);
    expect(source.supports('https://www.topanimes.net/a/b')).toBe(true);
    expect(source.supports('https://meusanimes.blog/e/x-episodio-1/')).toBe(
      false,
    );
    expect(source.supports('https://notopanimes.net.evil.com/x')).toBe(false);
  });

  it('resolveEpisodeUrl tenta o slug sem sufixo dublado quando o original 404', async () => {
    queueFetch({ body: '', status: 404 }, { body: '<html>ok</html>' });

    const resolved = await source.resolveEpisodeUrl('one-piece-dublado', 1);

    expect(resolved).toBe(
      'https://topanimes.net/episodio/one-piece-episodio-1/',
    );
    expect(mockedFetchSafeRaw).toHaveBeenCalledTimes(2);
  });

  it('extractHttp extrai o HLS do player sk-api, melhor qualidade primeiro', async () => {
    queueFetch(
      { body: HLS_HTML },
      {
        body: JSON.stringify({
          status: 'success',
          midias: [
            {
              qualidade: 'FD',
              url: 'https://cdn.exemplo/video-fd.m3u8?hdnts=x',
            },
            {
              qualidade: 'SD',
              url: 'https://cdn.exemplo/video-sd.m3u8?hdnts=x',
            },
            {
              qualidade: 'LD',
              url: 'https://cdn.exemplo/video-ld.m3u8?hdnts=x',
            },
          ],
        }),
      },
    );

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: UA,
    });

    // SD (1080p) > LD (720p) > FD (360p).
    expect(result.videos).toEqual([
      'https://cdn.exemplo/video-sd.m3u8?hdnts=x',
      'https://cdn.exemplo/video-ld.m3u8?hdnts=x',
      'https://cdn.exemplo/video-fd.m3u8?hdnts=x',
    ]);
    expect(result.cloudflare).toBe(false);
    expect(mockedProbe).toHaveBeenCalledWith(
      'https://cdn.exemplo/video-sd.m3u8?hdnts=x',
      true,
    );
  });

  it('extractHttp descarta mídias mortas no probe', async () => {
    queueFetch(
      { body: HLS_HTML },
      {
        body: JSON.stringify({
          status: 'success',
          midias: [
            { qualidade: 'SD', url: 'https://cdn.exemplo/morta.m3u8' },
            { qualidade: 'FD', url: 'https://cdn.exemplo/viva.m3u8' },
          ],
        }),
      },
    );
    mockedProbe.mockImplementation(async (url) => url.includes('morta'));

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: UA,
    });

    expect(result.videos).toEqual(['https://cdn.exemplo/viva.m3u8']);
  });

  it('extractHttp devolve playerTokens Blogger quando não há player sk-api', async () => {
    queueFetch({ body: BLOGGER_HTML });

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: UA,
    });

    expect(result.videos).toEqual([]);
    expect(result.playerTokens).toEqual([
      'https://www.blogger.com/video.g?token=AD6v5dyGqQRTgspPq3ARl1yPAtmIn6c5JsuDLalrBA15V5v5Lp1KpVp',
    ]);
  });

  it('extractHttp lança quando a página não tem player nenhum', async () => {
    queueFetch({ body: '<html><p>sem video</p></html>' });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: UA }),
    ).rejects.toThrow(/sem player reconhecido/);
  });

  it('extractHttp lança quando o player responde status != success', async () => {
    queueFetch(
      { body: HLS_HTML },
      { body: JSON.stringify({ status: 'error', message: 'indisponivel' }) },
    );

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: UA }),
    ).rejects.toThrow(/indisponivel/);
  });
});
