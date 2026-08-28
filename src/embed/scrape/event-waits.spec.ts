import { extractPlayerVideoEventDriven } from './event-waits';

type RequestCb = (req: { url: () => string }) => void;

interface PageMockOverrides {
  /** Requests disparadas durante o goto (simula captura no load). */
  requestUrls?: string[];
  /** Requests disparadas no click('body') (simula play pós-clique). */
  clickRequestUrls?: string[];
}

function makePageMock(overrides: PageMockOverrides = {}) {
  const requestHandlers: RequestCb[] = [];
  const fire = (url: string) => {
    for (const h of requestHandlers) h({ url: () => url });
  };

  const page = {
    on: jest.fn((event: string, cb: RequestCb) => {
      if (event === 'request') requestHandlers.push(cb);
    }),
    off: jest.fn(),
    goto: jest.fn(async () => {
      for (const u of overrides.requestUrls ?? []) fire(u);
    }),
    waitForSelector: jest.fn(async () => undefined),
    waitForRequest: jest.fn(async () => undefined),
    waitForTimeout: jest.fn(async () => undefined),
    evaluate: jest.fn(async () => []),
    $: jest.fn(async () => null),
    isClosed: jest.fn(() => false),
    click: jest.fn(async () => {
      for (const u of overrides.clickRequestUrls ?? []) fire(u);
    }),
    mainFrame: jest.fn(() => ({ childFrames: jest.fn(() => []) })),
    close: jest.fn(async () => undefined),
  };
  return page;
}

describe('extractPlayerVideoEventDriven', () => {
  it('retorna videoplayback já capturado no load (caminho instantâneo, sem esperar prontidão)', async () => {
    const page = makePageMock({
      requestUrls: [
        'https://rr5.googlevideo.com/videoplayback?token=abc',
        'https://rr5.googlevideo.com/generate_204',
      ],
    });

    const videos = await extractPlayerVideoEventDriven(
      page as never,
      'https://www.blogger.com/video.g?token=x',
    );

    expect(videos).toEqual([
      'https://rr5.googlevideo.com/videoplayback?token=abc',
    ]);
    // Stream já existe: não há motivo para esperar prontidão nem clicar.
    expect(page.waitForRequest).not.toHaveBeenCalled();
    expect(page.waitForSelector).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });

  it('aguarda prontidão, clica no play e captura videoplayback disparado no clique', async () => {
    const page = makePageMock({
      clickRequestUrls: ['https://rr.googlevideo.com/videoplayback?tok=2'],
    });

    const videos = await extractPlayerVideoEventDriven(
      page as never,
      'https://www.blogger.com/video.g?token=y',
    );

    expect(videos).toEqual(['https://rr.googlevideo.com/videoplayback?tok=2']);
    expect(page.waitForSelector).toHaveBeenCalled();
    expect(page.waitForRequest).toHaveBeenCalled();
    expect(page.click).toHaveBeenCalledWith('body', expect.any(Object));
  });

  it('filtra URLs não-playable e deduplica requests repetidas', async () => {
    const page = makePageMock({
      requestUrls: [
        'https://rr.googlevideo.com/generate_204',
        'https://cdn.test/other.png',
        'https://rr.googlevideo.com/videoplayback?tok=1',
        'https://rr.googlevideo.com/videoplayback?tok=1',
      ],
    });

    const videos = await extractPlayerVideoEventDriven(
      page as never,
      'https://www.blogger.com/video.g?token=dup',
    );

    expect(videos).toEqual(['https://rr.googlevideo.com/videoplayback?tok=1']);
  });

  it('retorna [] quando nenhuma mídia é capturada', async () => {
    const page = makePageMock({});

    const videos = await extractPlayerVideoEventDriven(
      page as never,
      'https://www.blogger.com/video.g?token=z',
    );

    expect(videos).toEqual([]);
  });

  it('retorna [] e fecha a página quando o goto falha', async () => {
    const page = makePageMock({});
    page.goto.mockRejectedValueOnce(new Error('net::ERR_TIMED_OUT'));

    const videos = await extractPlayerVideoEventDriven(
      page as never,
      'https://www.blogger.com/video.g?token=w',
    );

    expect(videos).toEqual([]);
    expect(page.close).toHaveBeenCalled();
  });
});
