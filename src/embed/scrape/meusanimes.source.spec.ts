import { MeusanimesScrapeSource } from './meusanimes.source';
import { fetchSafeRaw } from '@/common/ssrf';
import { Dispatcher } from 'undici';

jest.mock('@/common/ssrf', () => ({
  fetchSafeRaw: jest.fn(),
}));

jest.mock('./extract', () => {
  const actual = jest.requireActual('./extract');
  return {
    ...actual,
    extractVideoElements: jest.fn(),
    extractAllIframes: jest.fn(),
  };
});

const mockedFetchSafeRaw = fetchSafeRaw as jest.MockedFunction<
  typeof fetchSafeRaw
>;

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const EPISODE_HTML = `
<html><body>
<div class="single_video">
  <div class="player_sist">
    <iframe src="https://serv01.meusdoramas.club/#/video/1432547/1/1/"></iframe>
  </div>
</div>
</body></html>
`;

const BLOGGER_JSON = JSON.stringify({
  success: true,
  videoUrl:
    'https://www.blogger.com/video.g?token=AD6v5dzWo_c_9RZ3gKCixrCKxUidiB7jVhLO2IQiubu7W57TzaZstrcUskB4CXe4B6UbGqu8c3CMPgCw-JUMLw8utDm4YQ5hgqypOpUvMVriyVGLMg9N8Z85ivJZnbxlxN4QhZt0WxYw',
});

const YOUTUBE_JSON = JSON.stringify({
  success: true,
  videoUrl:
    'https://www.youtube-nocookie.com/embed/0YpXN40vIxM?autoplay=1&playsinline=1',
});

const MP4_JSON = JSON.stringify({
  success: true,
  videoUrl: 'https://pub-c7f4.r2.dev/Leg.mp4',
});

function mockFetchSafeRaw(
  routes: Record<string, string>,
): jest.MockedFunction<typeof fetchSafeRaw> {
  const dispatcher = {
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Dispatcher;
  mockedFetchSafeRaw.mockImplementation(async (url: string) => {
    const body = routes[url] ?? routes['*'];
    if (body === undefined) {
      return {
        response: {
          ok: false,
          status: 404,
          text: async () => 'not found',
        } as Response,
        dispatcher,
      };
    }
    return {
      response: { ok: true, status: 200, text: async () => body } as Response,
      dispatcher,
    };
  });
  return mockedFetchSafeRaw;
}

describe('MeusanimesScrapeSource.extractHttp', () => {
  let source: MeusanimesScrapeSource;

  beforeEach(() => {
    source = new MeusanimesScrapeSource();
    mockedFetchSafeRaw.mockReset();
  });

  it('devolve blogger token como playerToken', async () => {
    const fetchMock = mockFetchSafeRaw({
      'https://meusanimes.blog/e/foo-1-episodio-1/': EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        BLOGGER_JSON,
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/foo-1-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual([]);
    expect(result.playerTokens).toHaveLength(1);
    expect(result.playerTokens![0]).toMatch(/blogger\.com\/video\.g\?token=/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('converte youtube-nocookie embed em playerToken de embed', async () => {
    const fetchMock = mockFetchSafeRaw({
      'https://meusanimes.blog/e/all-you-need-is-kill-episodio-1/':
        EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        YOUTUBE_JSON,
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/all-you-need-is-kill-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual([]);
    expect(result.playerTokens).toHaveLength(1);
    expect(result.playerTokens![0]).toBe(
      'https://www.youtube-nocookie.com/embed/0YpXN40vIxM',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('devolve .mp4 direto como video', async () => {
    mockFetchSafeRaw({
      'https://meusanimes.blog/e/foo-1-episodio-1/': EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        MP4_JSON,
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/foo-1-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual(['https://pub-c7f4.r2.dev/Leg.mp4']);
    expect(result.playerTokens).toEqual([]);
  });

  it('propaga erro quando get-video.php devolve 404', async () => {
    mockFetchSafeRaw({
      'https://meusanimes.blog/e/foo-1-episodio-1/': EPISODE_HTML,
    });
    await expect(
      source.extractHttp({
        episodeUrl: 'https://meusanimes.blog/e/foo-1-episodio-1/',
        ua: UA,
      }),
    ).rejects.toThrow(/404/);
  });
});

describe('MeusanimesScrapeSource (cobertura ampliada)', () => {
  let source: MeusanimesScrapeSource;

  beforeEach(() => {
    source = new MeusanimesScrapeSource();
    mockedFetchSafeRaw.mockReset();
    const helpers = jest.requireMock('./extract');
    helpers.extractVideoElements.mockReset();
    helpers.extractAllIframes.mockReset();
  });

  const EMBED_JSON = JSON.stringify({
    videoUrl: 'https://video.meusdoramas.club/embed/abc-123',
  });

  const EMBED_HTML = `<script>
    "file":"https:\\/\\/pub-c7f4.r2.dev\\/Leg.mp4",
    "file":"https:\\/\\/cdn.host\\/s3.mp4?X-Amz-Expires=100",
    "file":"\\/relative\\/a.mp4"
  </script>`;

  const PICKER_JSON = JSON.stringify({
    videoUrl: 'https://serv01.meusdoramas.club/e/?a=1/2/3',
  });

  const PICKER_HTML = `<script>location.href='iframe.php?a=1/2/3/'</script>`;

  const IFRAME_HTML = `<iframe src="https://serv02.meusdoramas.club/#/video/999/2/3/"></iframe>`;

  it('supports reconhece meusanimes.blog e meusdoramas.club', () => {
    expect(source.supports('https://meusanimes.blog/e/x-episodio-1/')).toBe(
      true,
    );
    expect(
      source.supports('https://serv01.meusdoramas.club/#/video/1/1/1'),
    ).toBe(true);
    expect(source.supports('https://animefire.io/x')).toBe(false);
  });

  it('propaga erro da página do episódio com prefixo meusanimes', async () => {
    mockedFetchSafeRaw.mockRejectedValueOnce(new Error('conn refused'));
    await expect(
      source.extractHttp({
        episodeUrl: 'https://meusanimes.blog/e/x-episodio-1/',
        ua: UA,
      }),
    ).rejects.toThrow('meusanimes: fetch failed para');
  });

  it('ignora resposta não-JSON do get-video.php', async () => {
    mockFetchSafeRaw({
      'https://meusanimes.blog/e/x-episodio-1/': EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        '<html>erro</html>',
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/x-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual([]);
    expect(result.playerTokens).toEqual([]);
  });

  it('ignora videoUrl que não é string', async () => {
    mockFetchSafeRaw({
      'https://meusanimes.blog/e/x-episodio-1/': EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        JSON.stringify({ videoUrl: 123 }),
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/x-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual([]);
  });

  it('extrai .mp4 do embed do MeuDoramas e prefere URLs permanentes', async () => {
    mockFetchSafeRaw({
      'https://meusanimes.blog/e/x-episodio-1/': EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        EMBED_JSON,
      'https://video.meusdoramas.club/embed/abc-123': EMBED_HTML,
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/x-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual([
      'https://pub-c7f4.r2.dev/Leg.mp4',
      'https://cdn.host/s3.mp4?X-Amz-Expires=100',
    ]);
  });

  it('ignora embed do MeuDoramas irresolvível', async () => {
    mockFetchSafeRaw({
      'https://meusanimes.blog/e/x-episodio-1/': EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        EMBED_JSON,
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/x-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual([]);
  });

  it('resolve seletor de servidores recursivamente via iframe.php', async () => {
    const fetchMock = mockFetchSafeRaw({
      'https://meusanimes.blog/e/x-episodio-1/': EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        PICKER_JSON,
      'https://serv01.meusdoramas.club/e/?a=1/2/3': PICKER_HTML,
      'https://serv01.meusdoramas.club/e/iframe.php?a=1/2/3/': IFRAME_HTML,
      'https://serv02.meusdoramas.club/posts/get-video.php?tmdb=999&season_number=2&episode_number=3':
        MP4_JSON,
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/x-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual(['https://pub-c7f4.r2.dev/Leg.mp4']);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('ignora seletor de servidores irresolvível', async () => {
    mockFetchSafeRaw({
      'https://meusanimes.blog/e/x-episodio-1/': EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        PICKER_JSON,
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/x-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual([]);
  });

  it('não revisita servidor já processado (visited)', async () => {
    const pickerTwo = `<script>location.href='iframe.php?a=1/2/3/';location.href='iframe.php?b=1/2/3/'</script>`;
    const fetchMock = mockFetchSafeRaw({
      'https://meusanimes.blog/e/x-episodio-1/': EPISODE_HTML,
      'https://serv01.meusdoramas.club/posts/get-video.php?tmdb=1432547&season_number=1&episode_number=1':
        PICKER_JSON,
      'https://serv01.meusdoramas.club/e/?a=1/2/3': pickerTwo,
      'https://serv01.meusdoramas.club/e/iframe.php?a=1/2/3/': IFRAME_HTML,
      'https://serv01.meusdoramas.club/e/iframe.php?b=1/2/3/': IFRAME_HTML,
      'https://serv02.meusdoramas.club/posts/get-video.php?tmdb=999&season_number=2&episode_number=3':
        MP4_JSON,
    });
    const result = await source.extractHttp({
      episodeUrl: 'https://meusanimes.blog/e/x-episodio-1/',
      ua: UA,
    });
    expect(result.videos).toEqual(['https://pub-c7f4.r2.dev/Leg.mp4']);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('extract (fallback Playwright) delega para os helpers', async () => {
    const helpers = jest.requireMock('./extract');
    helpers.extractVideoElements.mockResolvedValue([
      'https://cdn.test/v.mp4',
      'blob:fake',
      'https://cdn.test/v.m3u8',
    ]);
    helpers.extractAllIframes.mockResolvedValue(['https://iframe.test/p']);
    const result = await source.extract({} as never);
    expect(result.videos).toEqual([
      'https://cdn.test/v.mp4',
      'https://cdn.test/v.m3u8',
    ]);
    expect(result.iframes).toEqual(['https://iframe.test/p']);
    expect(result.cloudflare).toBe(false);
  });
});
