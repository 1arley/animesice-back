import { TopanimesScrapeSource } from './topanimes.source';
import { fetchSafeRaw } from '@/common/ssrf';
import { probeMediaUrlDead } from '@/common/media-probe';
import { extractAllIframes, extractVideoElements } from './extract';
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
const mockedExtractVideoElements = extractVideoElements as jest.MockedFunction<
  typeof extractVideoElements
>;
const mockedExtractAllIframes = extractAllIframes as jest.MockedFunction<
  typeof extractAllIframes
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

/** Player atual (17/10/2026): embed csst/fsst/incvideo1 com `file` por qualidade. */
const EMBED_HTML = `
  <div id='source-player-1' class='source-box'><iframe class='metaframe rptss' src='https://csst.online/embed/847846/'></iframe></div>
`;

const EMBED_PLAYER_HTML = `
  file:"[360p]https://www.incvideo1.online/get_file/9/aaa/847000/847846/847846_360p.mp4/,[720p]https://www.incvideo1.online/get_file/9/bbb/847000/847846/847846_720p.mp4/,[1080p]https://www.incvideo1.online/get_file/9/ccc/847000/847846/847846.mp4/"
`;

describe('TopanimesScrapeSource', () => {
  let source: TopanimesScrapeSource;

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks não volta a implementação: um caso que define
    // mockImplementation vaza para o seguinte.
    mockedProbe.mockImplementation(async () => false);
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

  it('resolveEpisodeUrl cai na listagem da página do anime quando o template falha', async () => {
    // Aspas SIMPLES — o que o tema emite. Um padrão que só caseia aspas
    // duplas faz a fonte parecer não ter episódios.
    const animePage = `
      <div class='episodiotitle'><a href='https://topanimes.net/episodio/buchigire-reijou-wo-tatakitsubushimasu-episodio-1/'>Episódio 1</a></div>
      <div class='episodiotitle'><a href='https://topanimes.net/episodio/buchigire-reijou-wo-tatakitsubushimasu-episodio-7/'>Episódio 7</a></div>
    `;
    // slug sem sufixo dublado => 1 variante => exists() 404 + página do anime
    queueFetch({ body: '', status: 404 }, { body: animePage });

    const resolved = await source.resolveEpisodeUrl('buchigire-reijou', 7);

    expect(resolved).toBe(
      'https://topanimes.net/episodio/buchigire-reijou-wo-tatakitsubushimasu-episodio-7/',
    );
  });

  it('resolveEpisodeUrl aceita aspas duplas também', async () => {
    const animePage = `<a href="https://topanimes.net/episodio/x-episodio-3/">3</a>`;
    queueFetch({ body: '', status: 404 }, { body: animePage });

    expect(await source.resolveEpisodeUrl('x', 3)).toBe(
      'https://topanimes.net/episodio/x-episodio-3/',
    );
  });

  it('resolveEpisodeUrl devolve null se a listagem não tem o episódio', async () => {
    const animePage = `<a href='https://topanimes.net/episodio/x-episodio-1/'>1</a>`;
    queueFetch({ body: '', status: 404 }, { body: animePage });

    expect(await source.resolveEpisodeUrl('x', 9)).toBeNull();
  });

  it('resolveEpisodeUrl tenta as duas variantes antes da página do anime', async () => {
    const animePage = `<a href='https://topanimes.net/episodio/bleach-episodio-2/'>2</a>`;
    queueFetch(
      { body: '', status: 404 }, // exists(bleach-dublado-2)
      { body: '', status: 404 }, // exists(bleach)
      { body: '', status: 404 }, // pagina(bleach-dublado-2) -> 404
      { body: animePage },
    );

    expect(await source.resolveEpisodeUrl('bleach-dublado-2', 2)).toBe(
      'https://topanimes.net/episodio/bleach-episodio-2/',
    );
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

  it('extractHttp devolve os espelhos headful como playerToken (filemoon/mixdrop)', async () => {
    queueFetch({
      body: `
      <iframe src='https://topanimes.net/aviso/?url=https%3A%2F%2Ffilemoon.sx%2Fe%2F56s8179zbevb%3Fposter%3Dhttps%3A%2F%2Fimg'></iframe>
      <iframe src='https://topanimes.net/aviso/?url=https%3A%2F%2Fmixdrop.ag%2Fe%2F7rzw7kxocgvd7e'></iframe>
      <iframe src='https://topanimes.net/aviso/?url=https%3A%2F%2Fstreamtape.com%2Fe%2Fabc'></iframe>
    `,
    });

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: UA,
    });

    // streamtape fica de fora: o espelho morre com 404, não há o que extrair.
    expect(result.playerTokens).toEqual([
      'https://filemoon.sx/e/56s8179zbevb',
      'https://mixdrop.ag/e/7rzw7kxocgvd7e',
    ]);
    expect(result.videos).toEqual([]);
  });

  it('extractHttp extrai o player embed atual, maior qualidade primeiro', async () => {
    queueFetch({ body: EMBED_HTML }, { body: EMBED_PLAYER_HTML });

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: UA,
    });

    expect(result.videos).toEqual([
      'https://www.incvideo1.online/get_file/9/ccc/847000/847846/847846.mp4',
      'https://www.incvideo1.online/get_file/9/bbb/847000/847846/847846_720p.mp4',
      'https://www.incvideo1.online/get_file/9/aaa/847000/847846/847846_360p.mp4',
    ]);
    expect(result.cloudflare).toBe(false);
  });

  it('extractHttp segue o embed fsst e descarta mídias mortas no probe', async () => {
    queueFetch(
      {
        body: "<iframe src='https://fsst.online/embed/12345/'></iframe>",
      },
      { body: EMBED_PLAYER_HTML },
    );
    mockedProbe.mockImplementation(async (url) => url.includes('_360p'));

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: UA,
    });

    expect(result.videos).toEqual([
      'https://www.incvideo1.online/get_file/9/ccc/847000/847846/847846.mp4',
      'https://www.incvideo1.online/get_file/9/bbb/847000/847846/847846_720p.mp4',
    ]);
  });

  it('extractHttp cai no player Blogger quando o embed não devolve mídia viva', async () => {
    queueFetch(
      { body: `${EMBED_HTML}${BLOGGER_HTML}` },
      { body: '[1080p]https://cdn.exemplo/morta.mp4' },
    );
    mockedProbe.mockResolvedValue(true);

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: UA,
    });

    expect(result.videos).toEqual([]);
    expect(result.playerTokens).toHaveLength(1);
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

  it('resolveEpisodeUrl devolve null quando nenhuma variante existe', async () => {
    queueFetch({ body: '', status: 404 });

    expect(await source.resolveEpisodeUrl('nao-existe-dublado', 1)).toBeNull();
  });

  it('extractHttp propaga erro de rede da página do episódio', async () => {
    mockedFetchSafeRaw.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: UA }),
    ).rejects.toThrow(/ECONNRESET/);
  });

  it('extractHttp propaga erro de rede do player, incluindo a causa', async () => {
    queueFetch({ body: HLS_HTML });
    mockedFetchSafeRaw.mockRejectedValueOnce(
      Object.assign(new Error('socket hang up'), { cause: new Error('dns') }),
    );

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: UA }),
    ).rejects.toThrow(/dns/);
  });

  it('extractHttp propaga 404 do player', async () => {
    queueFetch({ body: HLS_HTML }, { body: '', status: 404 });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: UA }),
    ).rejects.toThrow(/retornou 404/);
  });

  it('extractHttp lança quando o player devolve HTML em vez de JSON', async () => {
    queueFetch({ body: HLS_HTML }, { body: '<html>shell</html>' });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: UA }),
    ).rejects.toThrow(/JSON invalida/);
  });

  it('extractHttp aceita qualidade desconhecida e descarta url inválida', async () => {
    queueFetch(
      { body: HLS_HTML },
      {
        body: JSON.stringify({
          status: 'success',
          midias: [
            { url: 'https://cdn.exemplo/sem-qualidade.m3u8' },
            { qualidade: 'LD', url: 'https://cdn.exemplo/ld.m3u8' },
            { url: 'nao-e-url.m3u8' },
          ],
        }),
      },
    );

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: UA,
    });

    expect(result.videos).toEqual([
      'https://cdn.exemplo/ld.m3u8',
      'https://cdn.exemplo/sem-qualidade.m3u8',
    ]);
  });

  it('extract(page) é o fallback Playwright e devolve vídeos do DOM', async () => {
    const page = {} as never;
    mockedExtractVideoElements.mockResolvedValue([
      'https://cdn.exemplo/x.m3u8',
      'https://nao-e-midias/y',
    ] as never);
    mockedExtractAllIframes.mockResolvedValue(['https://a/1'] as never);

    const result = await source.extract(page);

    expect(result.videos).toEqual([
      'https://cdn.exemplo/x.m3u8',
      'https://nao-e-midias/y',
    ]);
    expect(result.iframes).toEqual(['https://a/1']);
    expect(result.cloudflare).toBe(false);
  });

  it('extractHttp aceita player sem status nem message no erro', async () => {
    queueFetch({ body: HLS_HTML }, { body: JSON.stringify({}) });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: UA }),
    ).rejects.toThrow(/desconhecido/);
  });

  it('extractHttp lida com erro que não é instância de Error', async () => {
    mockedFetchSafeRaw.mockRejectedValueOnce('falha crua em string');

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: UA }),
    ).rejects.toThrow(/falha crua em string/);
  });
});
