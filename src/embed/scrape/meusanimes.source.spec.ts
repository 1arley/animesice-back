import { MeusanimesScrapeSource } from './meusanimes.source';

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

function mockFetchResponder(routes: Record<string, string>): jest.Mock {
  const fn = jest.fn(async (url: string) => {
    const body = routes[url] ?? routes['*'];
    if (body === undefined) {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    return { ok: true, status: 200, text: async () => body };
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('MeusanimesScrapeSource.extractHttp', () => {
  let source: MeusanimesScrapeSource;

  beforeEach(() => {
    source = new MeusanimesScrapeSource();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('devolve blogger token como playerToken', async () => {
    const fetchMock = mockFetchResponder({
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

  it('converte youtube-nocookie embed em playerToken de watch', async () => {
    const fetchMock = mockFetchResponder({
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
      'https://www.youtube.com/watch?v=0YpXN40vIxM',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('devolve .mp4 direto como video', async () => {
    mockFetchResponder({
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
    mockFetchResponder({
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
