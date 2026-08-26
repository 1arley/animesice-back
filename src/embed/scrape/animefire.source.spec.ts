import { AnimefireScrapeSource } from './animefire.source';
import { fetchSafeRaw } from '@/common/ssrf';
import { Dispatcher } from 'undici';

jest.mock('@/common/ssrf', () => ({
  fetchSafeRaw: jest.fn(),
}));

jest.mock('./extract', () => {
  const actual = jest.requireActual('./extract');
  return {
    keepVideoUrls: actual.keepVideoUrls,
    extractVideoElements: jest.fn(),
    extractAllIframes: jest.fn(),
  };
});

const mockedFetchSafeRaw = fetchSafeRaw as jest.MockedFunction<
  typeof fetchSafeRaw
>;

function makeResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://animefire.io/',
    headers: { get: () => null },
    text: async () => body,
  } as unknown as Response;
}

function mockFetchSafeRaw(
  pageHtml: string,
  videoJson: string | null,
): jest.MockedFunction<typeof fetchSafeRaw> {
  const dispatcher = {
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Dispatcher;
  mockedFetchSafeRaw.mockImplementation(async (url: string) => {
    if (videoJson === null) {
      return {
        response: makeResponse('not found', 404),
        dispatcher,
      };
    }
    if (url.includes('/video/')) {
      return {
        response: makeResponse(videoJson, 200),
        dispatcher,
      };
    }
    return {
      response: makeResponse(pageHtml, 200),
      dispatcher,
    };
  });
  return mockedFetchSafeRaw;
}

const PAGE_WITH_VIDEO_SRC = `<html><body>
  <video data-video-src="https://animefire.io/video/xyz123?data=1" id="player"></video>
</body></html>`;

const VIDEO_JSON = JSON.stringify({
  data: [
    {
      src: 'https:\\/\\/lightspeedst.net\\/content\\/animes\\/xyz\\/hd\\/1.mp4?token=abc',
      label: '720p',
    },
    {
      src: 'https:\\/\\/lightspeedst.net\\/content\\/animes\\/xyz\\/sd\\/1.mp4?token=abc',
      label: '480p',
    },
    { src: 'not-an-http-url', label: 'invalid' },
  ],
});

describe('AnimefireScrapeSource', () => {
  let source: AnimefireScrapeSource;

  beforeEach(() => {
    source = new AnimefireScrapeSource();
    mockedFetchSafeRaw.mockReset();
  });

  describe('supports', () => {
    it('reconhece hosts animefire.*', () => {
      expect(source.supports('https://animefire.io/animes/x/1')).toBe(true);
      expect(source.supports('https://animefire.tv/animes/x/1')).toBe(true);
      expect(source.supports('https://animesonlinecc.to/x')).toBe(false);
    });
  });

  describe('extractHttp', () => {
    it('retorna URLs .mp4 ordenadas com hd primeiro', async () => {
      mockFetchSafeRaw(PAGE_WITH_VIDEO_SRC, VIDEO_JSON);
      const result = await source.extractHttp({
        episodeUrl: 'https://animefire.io/animes/xyz/1',
        ua: 'UA-test',
      });
      expect(result.videos[0]).toContain('/hd/1.mp4');
      expect(result.videos[1]).toContain('/sd/1.mp4');
      expect(result.iframes).toEqual([]);
      expect(result.cloudflare).toBe(false);
    });

    it('desduplica URLs repetidas', async () => {
      const dupJson = JSON.stringify({
        data: [
          { src: 'https:\\/\\/cdn.test\\/v.mp4?t=1', label: '720p' },
          { src: 'https:\\/\\/cdn.test\\/v.mp4?t=1', label: '720p' },
        ],
      });
      mockFetchSafeRaw(PAGE_WITH_VIDEO_SRC, dupJson);
      const result = await source.extractHttp({
        episodeUrl: 'https://animefire.io/animes/x/1',
        ua: 'UA-test',
      });
      expect(result.videos).toHaveLength(1);
    });

    it('lança erro quando a página do episódio retorna 404', async () => {
      mockFetchSafeRaw('nf', null);
      await expect(
        source.extractHttp({
          episodeUrl: 'https://animefire.io/animes/x/1',
          ua: 'UA-test',
        }),
      ).rejects.toThrow(/404/);
    });

    it('lança erro quando data-video-src não existe no HTML', async () => {
      mockFetchSafeRaw('<html><body>sem player</body></html>', VIDEO_JSON);
      await expect(
        source.extractHttp({
          episodeUrl: 'https://animefire.io/animes/x/1',
          ua: 'UA-test',
        }),
      ).rejects.toThrow(/data-video-src/);
    });

    it('lança erro quando /video retorna erro', async () => {
      const dispatcher = {
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as Dispatcher;
      mockedFetchSafeRaw.mockImplementation(async (url: string) => {
        if (url.includes('/video/')) {
          return {
            response: makeResponse('erro', 500),
            dispatcher,
          };
        }
        return {
          response: makeResponse(PAGE_WITH_VIDEO_SRC, 200),
          dispatcher,
        };
      });
      await expect(
        source.extractHttp({
          episodeUrl: 'https://animefire.io/animes/x/1',
          ua: 'UA-test',
        }),
      ).rejects.toThrow(/500/);
    });

    it('lança erro quando JSON de fontes está vazio', async () => {
      mockFetchSafeRaw(PAGE_WITH_VIDEO_SRC, JSON.stringify({ data: [] }));
      await expect(
        source.extractHttp({
          episodeUrl: 'https://animefire.io/animes/x/1',
          ua: 'UA-test',
        }),
      ).rejects.toThrow(/vazio/);
    });

    it('lança erro quando resposta excede limite de bytes', async () => {
      const dispatcher = {
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as Dispatcher;
      mockedFetchSafeRaw.mockImplementation(async () => ({
        response: {
          ok: true,
          status: 200,
          headers: { get: () => String(6 * 1024 * 1024) },
          text: async () => 'x'.repeat(6 * 1024 * 1024),
        } as unknown as Response,
        dispatcher,
      }));
      await expect(
        source.extractHttp({
          episodeUrl: 'https://animefire.io/animes/x/1',
          ua: 'UA-test',
        }),
      ).rejects.toThrow(/limite/);
    });

    it('fecha o dispatcher da página mesmo em erro', async () => {
      const dispatcher = {
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as Dispatcher;
      mockedFetchSafeRaw.mockImplementation(async () => ({
        response: makeResponse('nf', 404),
        dispatcher,
      }));
      await expect(
        source.extractHttp({
          episodeUrl: 'https://animefire.io/animes/x/1',
          ua: 'UA-test',
        }),
      ).rejects.toThrow();
      expect(dispatcher.close).toHaveBeenCalled();
    });
  });

  describe('extract (Playwright fallback)', () => {
    it('delega para os helpers de extração e mantém apenas .mp4/.m3u8', async () => {
      const extractHelpers = jest.requireMock('./extract');
      extractHelpers.extractVideoElements.mockResolvedValue([
        'https://cdn.test/v.mp4',
        'blob:fake',
        'https://cdn.test/v.m3u8',
      ]);
      extractHelpers.extractAllIframes.mockResolvedValue([
        'https://iframe.test/player',
      ]);

      const result = await source.extract({} as never);
      expect(result.videos).toEqual([
        'https://cdn.test/v.mp4',
        'https://cdn.test/v.m3u8',
      ]);
      expect(result.iframes).toEqual(['https://iframe.test/player']);
      expect(result.cloudflare).toBe(false);
    });
  });
});

describe('AnimefireScrapeSource (leitura em stream)', () => {
  let source: AnimefireScrapeSource;

  beforeEach(() => {
    source = new AnimefireScrapeSource();
    mockedFetchSafeRaw.mockReset();
  });

  function makeStreamBody(chunks: Uint8Array[]) {
    let i = 0;
    const reader = {
      read: jest.fn(async () =>
        i < chunks.length
          ? { done: false, value: chunks[i++] }
          : { done: true },
      ),
      cancel: jest.fn(async () => undefined),
    };
    return { body: { getReader: () => reader }, reader };
  }

  it('lê página e JSON a partir do body em stream', async () => {
    const html = new TextEncoder().encode(
      '<video data-video-src="https://animefire.io/video/z1?d=1">',
    );
    const json = new TextEncoder().encode(
      JSON.stringify({
        data: [{ src: 'https:\\/\\/cdn.test\\/hd\\/1.mp4', label: '720p' }],
      }),
    );
    const pageBody = makeStreamBody([html.slice(0, 20), html.slice(20)]);
    const videoBody = makeStreamBody([json]);
    const dispatcher = {
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as Dispatcher;
    mockedFetchSafeRaw.mockImplementation(async (url: string) => ({
      response: {
        ok: true,
        status: 200,
        url: 'https://animefire.io/',
        headers: { get: () => null },
        body: url.includes('/video/') ? videoBody.body : pageBody.body,
      } as unknown as Response,
      dispatcher,
    }));

    const result = await source.extractHttp({
      episodeUrl: 'https://animefire.io/animes/x/1',
      ua: 'UA-test',
    });
    expect(result.videos).toEqual(['https://cdn.test/hd/1.mp4']);
    expect(pageBody.reader.read).toHaveBeenCalled();
    expect(videoBody.reader.read).toHaveBeenCalled();
    expect(dispatcher.close).toHaveBeenCalledTimes(2);
  });

  it('cancela o stream e lança quando estoura o limite de bytes', async () => {
    const big = new TextEncoder().encode('x'.repeat(6 * 1024 * 1024));
    const body = makeStreamBody([big]);
    const dispatcher = {
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as Dispatcher;
    mockedFetchSafeRaw.mockImplementation(async () => ({
      response: {
        ok: true,
        status: 200,
        url: 'https://animefire.io/',
        headers: { get: () => null },
        body: body.body,
      } as unknown as Response,
      dispatcher,
    }));

    await expect(
      source.extractHttp({
        episodeUrl: 'https://animefire.io/animes/x/1',
        ua: 'UA-test',
      }),
    ).rejects.toThrow(/limite/);
    expect(body.reader.cancel).toHaveBeenCalled();
  });
});
