import { AnimesorionScrapeSource } from './animesorion.source';
import { fetchSafeRaw } from '@/common/ssrf';
import { extractAllIframes, extractVideoElements } from './extract';
import type { Dispatcher } from 'undici';

jest.mock('@/common/ssrf', () => ({
  fetchSafeRaw: jest.fn(),
}));

jest.mock('./extract', () => ({
  extractVideoElements: jest.fn(),
  extractAllIframes: jest.fn(),
  keepVideoUrls: jest.fn((urls: string[]) => urls),
}));

const mockedFetchSafeRaw = fetchSafeRaw as jest.MockedFunction<
  typeof fetchSafeRaw
>;
const mockedExtractVideoElements = extractVideoElements as jest.MockedFunction<
  typeof extractVideoElements
>;
const mockedExtractAllIframes = extractAllIframes as jest.MockedFunction<
  typeof extractAllIframes
>;

const EPISODE_URL = 'https://animesorion.cc/episodios/black-clover-1x1/';

const KIT_HTML = `
  <iframe class='metaframe rptss' src='https://myembed.biz/serie/73223/1/1'></iframe>
`;

/** Enfileira respostas na ordem em que o adapter vai pedir. */
function queueFetch(
  ...responses: { body: string; status?: number; noBody?: boolean }[]
): void {
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

/** Resposta OK com dispatcher descartável. */
function makeOkResponse(body: string): {
  response: Response;
  dispatcher: Dispatcher;
} {
  const dispatcher = {
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Dispatcher;
  return {
    response: {
      ok: true,
      status: 200,
      text: async () => body,
      body: { cancel: jest.fn().mockResolvedValue(undefined) },
    } as unknown as Response,
    dispatcher,
  };
}

/** Resposta com status forcado (para exercitar o caminho de erro). */
function makeStatusResponse(status: number): {
  response: Response;
  dispatcher: Dispatcher;
} {
  const { dispatcher } = makeOkResponse('');
  return {
    response: {
      ok: false,
      status,
      text: async () => '',
      body: { cancel: jest.fn().mockResolvedValue(undefined) },
    } as unknown as Response,
    dispatcher,
  };
}

describe('AnimesorionScrapeSource', () => {
  let source: AnimesorionScrapeSource;

  beforeEach(() => {
    jest.clearAllMocks();
    source = new AnimesorionScrapeSource();
  });

  it('supports() aceita os dois hosts da rede', () => {
    expect(source.supports('https://animesorion.cc/episodios/x-1x1/')).toBe(
      true,
    );
    expect(source.supports('https://animexhd.xyz/episodios/x-1x1/')).toBe(true);
    expect(
      source.supports('https://topanimes.net/episodio/x-episodio-1/'),
    ).toBe(false);
  });

  it('episodeUrl usa o template NxM da rede Kitsune', () => {
    expect(source.episodeUrl('one-piece', 3, 2)).toBe(
      'https://animesorion.cc/episodios/one-piece-2x3/',
    );
  });

  it('slugVariants cai a variante sem sufixo dublado', () => {
    expect(source.slugVariants('bleach-dublado-2')).toEqual([
      'bleach-dublado-2',
      'bleach',
    ]);
    expect(source.slugVariants('one-piece')).toEqual(['one-piece']);
  });

  it('resolveEpisodeUrl tenta a variante sem sufixo quando a original 404', async () => {
    queueFetch({ body: '', status: 404 }, { body: '<html>ok</html>' });

    const resolved = await source.resolveEpisodeUrl(
      'black-clover-dublado',
      1,
      1,
      'https://animesorion.cc',
    );

    expect(resolved).toBe('https://animesorion.cc/episodios/black-clover-1x1/');
    expect(mockedFetchSafeRaw).toHaveBeenCalledTimes(2);
  });

  it('resolveEpisodeUrl cai na listagem da página do anime quando o template falha', async () => {
    // Aspas SIMPLES, formato <season>x<ep>. Precisa casaar season E episódio:
    // sem o filtro, o ep 1 da temporada 2 seria aceito como o da 1.
    const animePage = `
      <a href='https://animesorion.cc/episodios/pokemon-1x1/'>1x1</a>
      <a href='https://animesorion.cc/episodios/pokemon-2x1/'>2x1</a>
      <a href='https://animesorion.cc/episodios/pokemon-1x3/'>1x3</a>
    `;
    // slug sem sufixo dublado => 1 variante => exists() 404 + página do anime
    queueFetch({ body: '', status: 404 }, { body: animePage });

    const resolved = await source.resolveEpisodeUrl(
      'pokemon-2023',
      3,
      1,
      'https://animesorion.cc',
    );

    expect(resolved).toBe('https://animesorion.cc/episodios/pokemon-1x3/');
  });

  it('resolveEpisodeUrl da listagem respeita a temporada', async () => {
    const animePage = `
      <a href='https://animexhd.xyz/episodios/pokemon-1x1/'>1x1</a>
      <a href='https://animexhd.xyz/episodios/pokemon-2x1/'>2x1</a>
    `;
    queueFetch({ body: '', status: 404 }, { body: animePage });

    expect(
      await source.resolveEpisodeUrl('pokemon', 1, 2, 'https://animexhd.xyz'),
    ).toBe('https://animexhd.xyz/episodios/pokemon-2x1/');
  });

  it('extractHttp extrai o serie id do iframe myembed e devolve tokens Blogger', async () => {
    queueFetch(
      { body: KIT_HTML },
      {
        body: JSON.stringify({
          status: true,
          data: {
            options: [
              {
                embed: 'https://www.blogger.com/video.g?token=abc',
                lang: 'pt-br',
                label: 'Blogger',
              },
              {
                embed: 'https://www.blogger.com/video.g?token=def',
                lang: 'en-us',
              },
            ],
          },
        }),
      },
    );

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: 'ua',
    });

    expect(result.videos).toEqual([]);
    expect(result.playerTokens).toEqual([
      'https://www.blogger.com/video.g?token=abc',
      'https://www.blogger.com/video.g?token=def',
    ]);
    expect(result.cloudflare).toBe(false);

    // O Ajax do player exige Referer do próprio player.
    const [, ajax] = mockedFetchSafeRaw.mock.calls;
    expect(String(ajax![0])).toContain(
      'playerflix.ink/inc/Ajax.php?type=tv&id=73223&season=1&episode=1',
    );
    expect((ajax![1].headers as Record<string, string>).referer).toBe(
      'https://playerflix.ink/serie/73223/1/1',
    );
  });

  it('extractHttp dedupe tokens repetidos', async () => {
    queueFetch(
      { body: KIT_HTML },
      {
        body: JSON.stringify({
          status: true,
          data: {
            options: [
              { embed: 'https://www.blogger.com/video.g?token=abc' },
              { embed: 'https://www.blogger.com/video.g?token=abc' },
            ],
          },
        }),
      },
    );

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: 'ua',
    });

    expect(result.playerTokens).toHaveLength(1);
  });

  it('filtra opções de player para o mesmo áudio do anime', async () => {
    queueFetch(
      { body: KIT_HTML },
      {
        body: JSON.stringify({
          status: true,
          data: {
            options: [
              { embed: 'https://player.test/dub', label: 'Português' },
              { embed: 'https://player.test/sub', label: 'Japanese' },
            ],
          },
        }),
      },
    );

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: 'ua',
      audio: 'DUBLADO',
    });
    expect(result.playerTokens).toEqual(['https://player.test/dub']);
  });

  it('rejeita iframe que aponta para outra temporada ou episódio', async () => {
    queueFetch({
      body: KIT_HTML.replace('/serie/73223/1/1', '/serie/73223/1/2'),
    });
    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/episódio diferente/);
    expect(mockedFetchSafeRaw).toHaveBeenCalledTimes(1);
  });

  it('extractHttp lança quando a página não tem iframe myembed', async () => {
    queueFetch({ body: '<html><p>sem player</p></html>' });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/sem iframe myembed/);
  });

  it('extractHttp lança quando o player não devolve nenhum embed', async () => {
    queueFetch(
      { body: KIT_HTML },
      { body: JSON.stringify({ status: true, data: { options: [] } }) },
    );

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/sem player/);
  });

  it('extractHttp funciona também no host animexhd (mesmo player)', async () => {
    queueFetch(
      { body: KIT_HTML },
      {
        body: JSON.stringify({
          status: true,
          data: {
            options: [{ embed: 'https://www.blogger.com/video.g?token=xyz' }],
          },
        }),
      },
    );

    const result = await source.extractHttp({
      episodeUrl: 'https://animexhd.xyz/episodios/one-piece-1x1/',
      ua: 'ua',
    });

    expect(result.playerTokens).toEqual([
      'https://www.blogger.com/video.g?token=xyz',
    ]);
  });

  it('extractHttp descarta embed sem esquema http', async () => {
    queueFetch(
      { body: KIT_HTML },
      {
        body: JSON.stringify({
          status: true,
          data: {
            options: [
              { embed: 'javascript:alert(1)' },
              { embed: 'https://www.blogger.com/video.g?token=ok' },
            ],
          },
        }),
      },
    );

    const result = await source.extractHttp({
      episodeUrl: EPISODE_URL,
      ua: 'ua',
    });

    expect(result.playerTokens).toEqual([
      'https://www.blogger.com/video.g?token=ok',
    ]);
  });

  it('extrai apenas quando a página corresponde ao episódio pedido', async () => {
    queueFetch(
      { body: `<iframe src='https://myembed.biz/serie/999/1/1'></iframe>` },
      {
        body: JSON.stringify({
          status: true,
          data: {
            options: [{ embed: 'https://www.blogger.com/video.g?token=q' }],
          },
        }),
      },
    );

    await source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' });

    const [, ajax] = mockedFetchSafeRaw.mock.calls;
    expect(String(ajax![0])).toContain('id=999&season=1&episode=1');
  });

  it('extractHttp propaga erro de rede do Ajax do player', async () => {
    mockedFetchSafeRaw
      .mockResolvedValueOnce(makeOkResponse(KIT_HTML))
      .mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/playerflix/);
  });

  it('extractHttp lança quando a página responde 404', async () => {
    mockedFetchSafeRaw.mockResolvedValueOnce(makeStatusResponse(404));

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/retornou 404/);
  });

  it('extractHttp lança quando o Ajax responde 500', async () => {
    queueFetch({ body: KIT_HTML }, { body: '', status: 500 });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/retornou 500/);
  });

  it('resolveEpisodeUrl devolve null quando nenhuma variante existe', async () => {
    queueFetch({ body: '', status: 404 });

    const resolved = await source.resolveEpisodeUrl('nao-existe-dublado', 1);

    expect(resolved).toBeNull();
  });

  it('extract(page) é o fallback Playwright e devolve vídeos do DOM', async () => {
    const page = {} as never;
    mockedExtractVideoElements.mockResolvedValue([
      'https://cdn.exemplo/x.mp4',
      'https://nao-e-midias/y',
    ] as never);
    mockedExtractAllIframes.mockResolvedValue(['https://a/1'] as never);

    const result = await source.extract(page);

    expect(result.videos).toEqual([
      'https://cdn.exemplo/x.mp4',
      'https://nao-e-midias/y',
    ]);
    expect(result.iframes).toEqual(['https://a/1']);
    expect(result.cloudflare).toBe(false);
  });

  it('extractHttp normaliza season/episode zerados para 1', async () => {
    queueFetch(
      { body: `<iframe src='https://myembed.biz/serie/555/0/0'></iframe>` },
      {
        body: JSON.stringify({
          status: true,
          data: {
            options: [{ embed: 'https://www.blogger.com/video.g?token=w' }],
          },
        }),
      },
    );

    await source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' });

    const [, ajax] = mockedFetchSafeRaw.mock.calls;
    expect(String(ajax![0])).toContain('id=555&season=1&episode=1');
  });

  it('extractHttp aceita embed sem data.options', async () => {
    queueFetch({ body: KIT_HTML }, { body: JSON.stringify({ status: true }) });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/sem player/);
  });

  it('extractHttp propaga 404 da página do episódio', async () => {
    mockedFetchSafeRaw.mockResolvedValueOnce(makeStatusResponse(404));

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/retornou 404/);
  });

  it('extractHttp funciona também no host animexhd (mesmo player)', async () => {
    queueFetch({ body: KIT_HTML }, { body: '' });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/vazio/);
  });

  it('extractHttp lança quando playerflix responde status=false', async () => {
    queueFetch({ body: KIT_HTML }, { body: JSON.stringify({ status: false }) });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/status=false/);
  });

  it('extractHttp lança quando playerflix não devolve JSON', async () => {
    queueFetch({ body: KIT_HTML }, { body: '<html>shell</html>' });

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/JSON/);
  });

  it('extractHttp propaga falha de rede da página do episódio', async () => {
    mockedFetchSafeRaw.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      source.extractHttp({ episodeUrl: EPISODE_URL, ua: 'ua' }),
    ).rejects.toThrow(/animesorion/);
  });
});
