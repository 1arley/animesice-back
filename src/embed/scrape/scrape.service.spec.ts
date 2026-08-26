import { ScrapeService } from '@/embed/scrape/scrape.service';
import type { ScrapeEpisodeResult } from '@/embed/scrape/scrape-source.interface';
import { ServiceUnavailableException } from '@nestjs/common';
import { chromium } from 'playwright';
import { ensureXvfb } from './xvfb.helper';

jest.mock('playwright', () => ({
  chromium: { launch: jest.fn() },
}));

jest.mock('./xvfb.helper', () => ({
  ensureXvfb: jest.fn(),
}));

const launchMock = chromium.launch as jest.MockedFunction<
  typeof chromium.launch
>;
const ensureXvfbMock = ensureXvfb as jest.MockedFunction<typeof ensureXvfb>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeSource {
  id: string;
  supports: (url: string) => boolean;
  extract: jest.Mock;
  extractHttp: jest.Mock;
}

interface MakeSourceOpts {
  http?: boolean;
  extractResult?: () => ScrapeEpisodeResult;
}

function makeSource(
  id: string,
  hosts: string[],
  videos: string[] = [`https://cdn.${id}.test/v.mp4`],
  opts: MakeSourceOpts = {},
): FakeSource {
  const extract = jest.fn(
    async (): Promise<ScrapeEpisodeResult> =>
      opts.extractResult?.() ?? { videos, iframes: [], cloudflare: false },
  );
  const extractHttp =
    opts.http === false
      ? (undefined as unknown as jest.Mock)
      : jest.fn(async (): Promise<ScrapeEpisodeResult> => ({
          videos,
          iframes: [],
          cloudflare: false,
        }));
  return {
    id,
    supports: (url: string) => hosts.some((h) => url.includes(h)),
    extract,
    extractHttp,
  };
}

function makeHealth() {
  return {
    rankedSources: jest.fn(async () => [
      'meusanimes',
      'animefire',
      'animesonlinecc',
    ]),
    recordSuccess: jest.fn(async () => undefined),
    recordFailure: jest.fn(async () => undefined),
  };
}

function makeMetrics() {
  return {
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordDegradedServe: jest.fn(),
    recordExtraction: jest.fn(),
    recordExtractionFailure: jest.fn(),
    recordReextract: jest.fn(),
  };
}

function makePrisma() {
  return {
    anime: {
      findUnique: jest.fn(async () => ({ id: 'a1' })),
    },
    episode: {
      findUnique: jest.fn(async () => ({
        id: 'e1',
        embedUrl: 'https://animefire.io/animes/x/1',
      })),
      update: jest.fn(async () => undefined),
    },
  };
}

function makePageMock(
  overrides: { title?: string; requestUrls?: string[] } = {},
) {
  const requestHandlers: Array<(req: { url: () => string }) => void> = [];
  const page = {
    on: jest.fn((event: string, cb: (req: { url: () => string }) => void) => {
      if (event === 'request') requestHandlers.push(cb);
    }),
    off: jest.fn(),
    goto: jest.fn(async () => {
      for (const u of overrides.requestUrls ?? []) {
        for (const h of requestHandlers) h({ url: () => u });
      }
    }),
    title: jest.fn(async () => overrides.title ?? 'Episódio 1'),
    waitForSelector: jest.fn(async () => undefined),
    waitForTimeout: jest.fn(async () => undefined),
    evaluate: jest.fn(async () => []),
    $: jest.fn(async () => null),
    isClosed: jest.fn(() => false),
    click: jest.fn(async () => undefined),
    mainFrame: jest.fn(() => ({ childFrames: jest.fn(() => []) })),
    close: jest.fn(async () => undefined),
  };
  return page;
}

function makeBrowserMock(pages: any[] = []) {
  let index = 0;
  const context = {
    newPage: jest.fn(async () => pages[index++] ?? makePageMock()),
    close: jest.fn(async () => undefined),
  };
  const browser = {
    newContext: jest.fn(async () => context),
    close: jest.fn(async () => undefined),
  };
  return { browser, context };
}

describe('ScrapeService (orquestração + cache SWR)', () => {
  const origTtl = process.env.SCRAPE_CACHE_TTL_MS;
  const origStale = process.env.SCRAPE_CACHE_STALE_MS;
  const origConcurrency = process.env.MAX_CONCURRENT_SCRAPES;
  const origQueueTimeout = process.env.SCRAPE_QUEUE_TIMEOUT_MS;
  const origApiPrefix = process.env.API_PREFIX;

  beforeEach(() => {
    launchMock.mockReset();
    ensureXvfbMock.mockReset();
  });

  afterEach(() => {
    delete process.env.SCRAPE_CACHE_TTL_MS;
    delete process.env.SCRAPE_CACHE_STALE_MS;
    delete process.env.MAX_CONCURRENT_SCRAPES;
    delete process.env.SCRAPE_QUEUE_TIMEOUT_MS;
    delete process.env.API_PREFIX;
  });

  afterAll(() => {
    if (origTtl === undefined) delete process.env.SCRAPE_CACHE_TTL_MS;
    else process.env.SCRAPE_CACHE_TTL_MS = origTtl;
    if (origStale === undefined) delete process.env.SCRAPE_CACHE_STALE_MS;
    else process.env.SCRAPE_CACHE_STALE_MS = origStale;
    if (origConcurrency === undefined)
      delete process.env.MAX_CONCURRENT_SCRAPES;
    else process.env.MAX_CONCURRENT_SCRAPES = origConcurrency;
    if (origQueueTimeout === undefined)
      delete process.env.SCRAPE_QUEUE_TIMEOUT_MS;
    else process.env.SCRAPE_QUEUE_TIMEOUT_MS = origQueueTimeout;
    if (origApiPrefix === undefined) delete process.env.API_PREFIX;
    else process.env.API_PREFIX = origApiPrefix;
  });

  function build(opts?: {
    ttlMs?: number;
    staleMs?: number;
    concurrency?: number;
    queueTimeoutMs?: number;
  }) {
    if (opts?.ttlMs !== undefined) {
      process.env.SCRAPE_CACHE_TTL_MS = String(opts.ttlMs);
    }
    if (opts?.staleMs !== undefined) {
      process.env.SCRAPE_CACHE_STALE_MS = String(opts.staleMs);
    }
    if (opts?.concurrency !== undefined) {
      process.env.MAX_CONCURRENT_SCRAPES = String(opts.concurrency);
    }
    if (opts?.queueTimeoutMs !== undefined) {
      process.env.SCRAPE_QUEUE_TIMEOUT_MS = String(opts.queueTimeoutMs);
    }
    const af = makeSource('animefire', ['animefire.io']);
    const aocc = makeSource('animesonlinecc', ['animesonlinecc.to']);
    const ms = makeSource('meusanimes', ['meusanimes.blog']);
    const prisma = makePrisma();
    const health = makeHealth();
    const metrics = makeMetrics();
    const svc = new ScrapeService(
      af as any,
      aocc as any,
      ms as any,
      prisma as any,
      health as any,
      metrics as any,
    );
    return { svc, af, aocc, ms, prisma, health, metrics };
  }

  it('usa a ordem do HealthMonitor quando múltiplas fontes suportam a URL', async () => {
    const { svc, af, ms, health } = build();
    health.rankedSources.mockResolvedValue([
      'meusanimes',
      'animefire',
      'animesonlinecc',
    ]);
    af.supports = (u) => u.includes('player.test');
    ms.supports = (u) => u.includes('player.test');
    const res = await svc.scrapeEpisodeVideo(
      'https://player.test/ep/1',
      undefined,
      false,
    );
    expect(res.videos[0]).toContain('cdn.meusanimes');
    expect(ms.extractHttp).toHaveBeenCalledTimes(1);
    expect(af.extractHttp).not.toHaveBeenCalled();
  });

  it('não quebra quando rankedSources está vazio (ordem estática de fallback)', async () => {
    const { svc, af, health } = build();
    health.rankedSources.mockResolvedValue([]);
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/1',
      undefined,
      false,
    );
    expect(res.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(1);
  });

  it('honra sourceId explícito mesmo fora da ordem de saúde', async () => {
    const { svc, aocc } = build();
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/1',
      'animesonlinecc',
      false,
    );
    expect(res.videos[0]).toContain('cdn.animesonlinecc');
    expect(aocc.extractHttp).toHaveBeenCalledTimes(1);
  });

  it('cacheia RAW e embrulha no proxy de mídia na saída (wrap)', async () => {
    const { svc, af } = build();
    const wrapped = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/1',
      undefined,
      true,
    );
    expect(wrapped.videos[0]).toMatch(/^\/api\/embed\/media\?url=/);
    expect(af.extractHttp).toHaveBeenCalledTimes(1);

    const raw = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/1',
      undefined,
      false,
    );
    expect(raw.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(1);
  });

  it('registra success com latência e NÃO registra em cache hit', async () => {
    const { svc, health } = build();
    await svc.scrapeEpisodeVideo('https://animefire.io/a/2', undefined, false);
    expect(health.recordSuccess).toHaveBeenCalledTimes(1);
    expect(health.recordSuccess).toHaveBeenCalledWith(
      'animefire',
      expect.any(Number),
    );

    await svc.scrapeEpisodeVideo('https://animefire.io/a/2', undefined, false);
    expect(health.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it('registra failure e propaga erro quando a fonte lança', async () => {
    const { svc, af, health } = build();
    af.extractHttp.mockRejectedValueOnce(new Error('boom'));
    await expect(
      svc.scrapeEpisodeVideo('https://animefire.io/a/3', undefined, false),
    ).rejects.toThrow('boom');
    expect(health.recordFailure).toHaveBeenCalledWith('animefire');
  });

  it('resultado vazio não é cacheado e registra failure', async () => {
    const { svc, af, health } = build();
    af.extractHttp.mockResolvedValueOnce({
      videos: [],
      iframes: [],
      cloudflare: false,
    });
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/4',
      undefined,
      false,
    );
    expect(res.videos).toHaveLength(0);
    expect(health.recordFailure).toHaveBeenCalledWith('animefire');

    await svc.scrapeEpisodeVideo('https://animefire.io/a/4', undefined, false);
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
  });

  it('SWR: dentro da janela stale serve imediatamente e revalida em background', async () => {
    const { svc, af, health } = build({ ttlMs: 50, staleMs: 60_000 });
    const first = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/5',
      undefined,
      false,
    );
    await sleep(120);

    let release!: (r: ScrapeEpisodeResult) => void;
    af.extractHttp.mockImplementationOnce(
      () =>
        new Promise<ScrapeEpisodeResult>((res) => {
          release = res;
        }),
    );

    const second = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/5',
      undefined,
      false,
    );
    expect(second.videos).toEqual(first.videos);
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
    expect(second.videos[0]).not.toContain('cdn.fresh');

    release({
      videos: ['https://cdn.fresh/v.mp4'],
      iframes: [],
      cloudflare: false,
    });
    await sleep(20);
    expect(health.recordSuccess).toHaveBeenCalledTimes(2);

    const third = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/5',
      undefined,
      false,
    );
    expect(third.videos[0]).toContain('cdn.fresh');
  });

  it('além da janela stale: refetch síncrono e cache atualizado', async () => {
    const { svc, af, health } = build({ ttlMs: 30, staleMs: 60 });
    await svc.scrapeEpisodeVideo('https://animefire.io/a/6', undefined, false);
    await sleep(150);

    const second = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/6',
      undefined,
      false,
    );
    expect(second.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
    expect(health.recordSuccess).toHaveBeenCalledTimes(2);
  });

  it('refresh forçado ignora cache fresco e aguarda uma URL nova', async () => {
    const { svc, af } = build({ ttlMs: 60_000, staleMs: 120_000 });
    const url = 'https://animefire.io/a/refresh';
    const first = await svc.scrapeEpisodeVideo(url, undefined, false);

    af.extractHttp.mockResolvedValueOnce({
      videos: ['https://cdn.animefire/fresh.mp4'],
      iframes: [],
      cloudflare: false,
    });
    const refreshed = await svc.scrapeEpisodeVideo(url, undefined, false, true);

    expect(refreshed.videos).not.toEqual(first.videos);
    expect(refreshed.videos).toEqual(['https://cdn.animefire/fresh.mp4']);
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
  });

  it('refresh forçado não degrada para uma URL stale expirada', async () => {
    const { svc, af } = build({ ttlMs: 60_000, staleMs: 120_000 });
    const url = 'https://animefire.io/a/refresh-failure';
    await svc.scrapeEpisodeVideo(url, undefined, false);
    af.extractHttp.mockRejectedValueOnce(new Error('provider down'));

    await expect(
      svc.scrapeEpisodeVideo(url, undefined, false, true),
    ).rejects.toThrow('provider down');
  });

  it('degradação: fetch falha além da janela mas serve stale em vez de quebrar', async () => {
    const { svc, af, health } = build({ ttlMs: 30, staleMs: 60 });
    const first = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/7',
      undefined,
      false,
    );
    await sleep(150);

    af.extractHttp.mockRejectedValueOnce(new Error('provider down'));
    const second = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/7',
      undefined,
      false,
    );
    expect(second.videos).toEqual(first.videos);
    expect(health.recordFailure).toHaveBeenCalledWith('animefire');
  });

  it('single-flight: chamadas concorrentes compartilham 1 fetch', async () => {
    const { svc, af } = build();
    let started!: () => void;
    let release!: (r: ScrapeEpisodeResult) => void;
    const gate = new Promise<void>((res) => {
      started = res;
    });
    af.extractHttp.mockImplementationOnce(() => {
      started();
      return new Promise<ScrapeEpisodeResult>((res) => {
        release = res;
      });
    });
    const p1 = svc.scrapeEpisodeVideo(
      'https://animefire.io/a/8',
      undefined,
      false,
    );
    const p2 = svc.scrapeEpisodeVideo(
      'https://animefire.io/a/8',
      undefined,
      false,
    );
    await gate;
    expect(af.extractHttp).toHaveBeenCalledTimes(1);

    release({
      videos: ['https://cdn.x/v.mp4'],
      iframes: [],
      cloudflare: false,
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.videos[0]).toBe('https://cdn.x/v.mp4');
    expect(r2.videos[0]).toBe('https://cdn.x/v.mp4');
    expect(af.extractHttp).toHaveBeenCalledTimes(1);
  });

  it('invalidateEpisode limpa o cache da URL', async () => {
    const { svc, af } = build();
    await svc.scrapeEpisodeVideo('https://animefire.io/a/9', undefined, false);
    svc.invalidateEpisode('https://animefire.io/a/9');
    await svc.scrapeEpisodeVideo('https://animefire.io/a/9', undefined, false);
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
  });

  it('reextractEpisodeVideo usa fonte saudável, invalida e semeia o cache', async () => {
    const { svc, af, prisma, health } = build();
    prisma.episode.findUnique.mockResolvedValue({
      id: 'e1',
      embedUrl: 'https://animefire.io/animes/x/1',
    });
    const url = 'https://animefire.io/animes/x/1';

    await svc.scrapeEpisodeVideo(url, undefined, false);
    const fresh = await svc.reextractEpisodeVideo('x', 1, 1);
    expect(fresh).toContain('cdn.animefire');
    expect(health.recordSuccess).toHaveBeenCalledWith(
      'animefire',
      expect.any(Number),
    );

    const again = await svc.scrapeEpisodeVideo(url, undefined, false);
    expect(again.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
  });
});

describe('ScrapeService (cobertura avançada)', () => {
  beforeEach(() => {
    launchMock.mockReset();
    ensureXvfbMock.mockReset();
  });

  afterEach(() => {
    delete process.env.SCRAPE_CACHE_TTL_MS;
    delete process.env.SCRAPE_CACHE_STALE_MS;
    delete process.env.MAX_CONCURRENT_SCRAPES;
    delete process.env.SCRAPE_QUEUE_TIMEOUT_MS;
    delete process.env.API_PREFIX;
  });

  function build(opts?: {
    ttlMs?: number;
    staleMs?: number;
    concurrency?: number;
    queueTimeoutMs?: number;
  }) {
    if (opts?.ttlMs !== undefined)
      process.env.SCRAPE_CACHE_TTL_MS = String(opts.ttlMs);
    if (opts?.staleMs !== undefined)
      process.env.SCRAPE_CACHE_STALE_MS = String(opts.staleMs);
    if (opts?.concurrency !== undefined)
      process.env.MAX_CONCURRENT_SCRAPES = String(opts.concurrency);
    if (opts?.queueTimeoutMs !== undefined)
      process.env.SCRAPE_QUEUE_TIMEOUT_MS = String(opts.queueTimeoutMs);
    const af = makeSource('animefire', ['animefire.io']);
    const aocc = makeSource('animesonlinecc', ['animesonlinecc.to']);
    const ms = makeSource('meusanimes', ['meusanimes.blog']);
    const prisma = makePrisma();
    const health = makeHealth();
    const metrics = makeMetrics();
    const svc = new ScrapeService(
      af as any,
      aocc as any,
      ms as any,
      prisma as any,
      health as any,
      metrics as any,
    );
    return { svc, af, aocc, ms, prisma, health, metrics };
  }

  it('usa valores padrão de TTL/stale/concorrência quando env ausente', async () => {
    const { svc } = build();
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/default',
      undefined,
      false,
    );
    expect(res.videos[0]).toContain('cdn.animefire');
  });

  it('usa fallbacks quando as env de config são inválidas', () => {
    process.env.SCRAPE_CACHE_TTL_MS = 'abc';
    process.env.SCRAPE_CACHE_STALE_MS = '-5';
    process.env.MAX_CONCURRENT_SCRAPES = '0';
    process.env.SCRAPE_QUEUE_TIMEOUT_MS = '0';
    const { svc } = build();
    expect(svc).toBeDefined();
  });

  it('cleanupExpiredCache remove apenas entradas fora da janela stale', async () => {
    const { svc } = build({ ttlMs: 30, staleMs: 60 });
    await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/clean',
      undefined,
      false,
    );
    const cache = (svc as any).cache as Map<string, any>;
    expect(cache.size).toBe(1);
    svc.cleanupExpiredCache();
    expect(cache.size).toBe(1);
    await sleep(100);
    svc.cleanupExpiredCache();
    expect(cache.size).toBe(0);
  });

  it('cai para a ordem base quando rankedSources lança', async () => {
    const { svc, af, health } = build();
    health.rankedSources.mockRejectedValueOnce(new Error('watchtower down'));
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/rk',
      undefined,
      false,
    );
    expect(res.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(1);
  });

  it('sourceId desconhecido cai para auto-detecção por host', async () => {
    const { svc, af } = build();
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/unknown',
      'nao-existe',
      false,
    );
    expect(res.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(1);
  });

  it('usa o adapter padrão (sources[0]) quando nenhuma fonte suporta a URL', async () => {
    const { svc, af } = build();
    const res = await svc.scrapeEpisodeVideo(
      'https://hostdesconhecido.example/x',
      undefined,
      false,
    );
    expect(res.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(1);
  });

  it('revalidação em background que falha é engolida e serve stale', async () => {
    const { svc, af, health } = build({ ttlMs: 50, staleMs: 60_000 });
    await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/stale-fail',
      undefined,
      false,
    );
    await sleep(120);
    af.extractHttp.mockRejectedValueOnce(new Error('bg down'));
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/stale-fail',
      undefined,
      false,
    );
    expect(res.videos[0]).toContain('cdn.animefire');
    await sleep(30);
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
    expect(health.recordFailure).toHaveBeenCalledWith('animefire');
  });

  it('serializa scrapes concorrentes além do limite (transferência da fila)', async () => {
    const { svc, af } = build({ concurrency: 1 });
    let started!: () => void;
    let release!: (r: ScrapeEpisodeResult) => void;
    const gate = new Promise<void>((res) => {
      started = res;
    });
    af.extractHttp.mockImplementationOnce(() => {
      started();
      return new Promise<ScrapeEpisodeResult>((res) => {
        release = res;
      });
    });
    const p1 = svc.scrapeEpisodeVideo(
      'https://animefire.io/a/q1',
      undefined,
      false,
    );
    await gate;
    const p2 = svc.scrapeEpisodeVideo(
      'https://animefire.io/a/q2',
      undefined,
      false,
    );
    await sleep(10);
    expect(af.extractHttp).toHaveBeenCalledTimes(1);

    release({
      videos: ['https://cdn.q/v.mp4'],
      iframes: [],
      cloudflare: false,
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.videos[0]).toBe('https://cdn.q/v.mp4');
    expect(r2.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
  });

  it('rejeita com ServiceUnavailableException quando a fila estoura o timeout', async () => {
    const { svc, af } = build({ concurrency: 1, queueTimeoutMs: 80 });
    let started!: () => void;
    let release!: (r: ScrapeEpisodeResult) => void;
    const gate = new Promise<void>((res) => {
      started = res;
    });
    af.extractHttp.mockImplementationOnce(() => {
      started();
      return new Promise<ScrapeEpisodeResult>((res) => {
        release = res;
      });
    });
    const p1 = svc.scrapeEpisodeVideo(
      'https://animefire.io/a/qt1',
      undefined,
      false,
    );
    await gate;
    const p2 = svc.scrapeEpisodeVideo(
      'https://animefire.io/a/qt2',
      undefined,
      false,
    );
    await expect(p2).rejects.toBeInstanceOf(ServiceUnavailableException);
    release({
      videos: ['https://cdn.qt/v.mp4'],
      iframes: [],
      cloudflare: false,
    });
    await expect(p1).resolves.toBeDefined();
  });

  it('não registra health p/ fonte fora do SOURCE_IDS', async () => {
    const af = makeSource('animefire', ['animefire.io']);
    const custom = makeSource('custom', ['custom.test']);
    const ms = makeSource('meusanimes', ['meusanimes.blog']);
    const prisma = makePrisma();
    const health = makeHealth();
    const metrics = makeMetrics();
    const svc = new ScrapeService(
      af as any,
      custom as any,
      ms as any,
      prisma as any,
      health as any,
      metrics as any,
    );
    await svc.scrapeEpisodeVideo('https://custom.test/x', 'custom', false);
    expect(health.recordSuccess).not.toHaveBeenCalled();
    expect(health.recordFailure).not.toHaveBeenCalled();
  });

  it('mantém playerTokens de YouTube quando extractHttp não resolve .mp4', async () => {
    const { svc, af } = build();
    af.extractHttp.mockResolvedValueOnce({
      videos: [],
      iframes: [],
      cloudflare: false,
      playerTokens: [
        'https://www.youtube-nocookie.com/embed/0YpXN40vIxM?autoplay=1',
      ],
    });
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/yt',
      undefined,
      false,
    );
    expect(res.videos).toEqual([]);
    expect(res.playerTokens).toEqual([
      'https://www.youtube-nocookie.com/embed/0YpXN40vIxM?autoplay=1',
    ]);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('expõe apenas embeds de YouTube quando há vídeo direto', async () => {
    const { svc, af } = build();
    af.extractHttp.mockResolvedValueOnce({
      videos: ['https://cdn/v.mp4'],
      iframes: [],
      cloudflare: false,
      playerTokens: [
        'https://www.youtube-nocookie.com/embed/0YpXN40vIxM?autoplay=1',
      ],
    });
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/yt2',
      undefined,
      false,
    );
    expect(res.videos).toEqual(['https://cdn/v.mp4']);
    expect(res.playerTokens).toEqual([
      'https://www.youtube-nocookie.com/embed/0YpXN40vIxM?autoplay=1',
    ]);
  });

  it('resolve player token Blogger via chromium headless e retorna videoplayback', async () => {
    const { svc, af } = build();
    const bvPage = makePageMock({
      requestUrls: [
        'https://rr5.googlevideo.com/videoplayback?token=abc',
        'https://rr5.googlevideo.com/generate_204',
      ],
    });
    const { browser, context } = makeBrowserMock([bvPage]);
    launchMock.mockResolvedValue(browser as any);
    af.extractHttp.mockResolvedValueOnce({
      videos: [],
      iframes: [],
      cloudflare: false,
      playerTokens: ['https://www.blogger.com/video.g?token=xyz'],
    });
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/bv',
      undefined,
      false,
    );
    expect(res.videos[0]).toContain('videoplayback');
    expect(launchMock).toHaveBeenCalledWith({
      headless: true,
      chromiumSandbox: false,
      args: [],
    });
    expect(context.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it('tenta múltiplos player tokens até um resolver', async () => {
    const { svc, af } = build();
    const emptyPage = makePageMock({});
    emptyPage.isClosed.mockReturnValue(true);
    const okPage = makePageMock({
      requestUrls: ['https://rr.googlevideo.com/videoplayback?tok=2'],
    });
    const { browser } = makeBrowserMock([emptyPage, okPage]);
    launchMock.mockResolvedValue(browser as any);
    af.extractHttp.mockResolvedValueOnce({
      videos: [],
      iframes: [],
      cloudflare: false,
      playerTokens: [
        'https://www.blogger.com/video.g?token=a',
        'https://www.blogger.com/video.g?token=b',
      ],
    });
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/multi',
      undefined,
      false,
    );
    expect(res.videos[0]).toContain('videoplayback?tok=2');
  });

  it('fallback Xvfb + headless:false quando headless falha p/ Blogger', async () => {
    const { svc, af } = build();
    const bvPage = makePageMock({});
    bvPage.isClosed.mockReturnValue(true);
    const { browser, context } = makeBrowserMock([bvPage]);
    launchMock
      .mockRejectedValueOnce(new Error('no headless'))
      .mockResolvedValueOnce(browser as any);
    ensureXvfbMock.mockResolvedValue(':99');
    af.extractHttp.mockResolvedValueOnce({
      videos: [],
      iframes: [],
      cloudflare: false,
      playerTokens: ['https://www.blogger.com/video.g?token=xyz'],
    });
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/xvfb',
      undefined,
      false,
    );
    expect(res.videos).toEqual([]);
    expect(res.playerTokens).toHaveLength(1);
    expect(ensureXvfbMock).toHaveBeenCalled();
    expect(launchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ headless: false }),
    );
    expect(context.close).toHaveBeenCalled();
  });

  it('não tenta headless:false quando Xvfb está indisponível', async () => {
    const { svc, af } = build();
    launchMock.mockRejectedValueOnce(new Error('no headless'));
    ensureXvfbMock.mockResolvedValue(null);
    af.extractHttp.mockResolvedValueOnce({
      videos: [],
      iframes: [],
      cloudflare: false,
      playerTokens: ['https://www.blogger.com/video.g?token=xyz'],
    });
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/noxvfb',
      undefined,
      false,
    );
    expect(res.videos).toEqual([]);
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  function makePlaywrightSvc() {
    const aocc = makeSource('animesonlinecc', ['animesonlinecc.to'], [], {
      http: false,
      extractResult: () => ({
        videos: ['https://cdn.playwright/v.mp4'],
        iframes: [],
        cloudflare: false,
      }),
    });
    const af = makeSource('animefire', ['animefire.io']);
    const ms = makeSource('meusanimes', ['meusanimes.blog']);
    const prisma = makePrisma();
    const health = makeHealth();
    const metrics = makeMetrics();
    const svc = new ScrapeService(
      af as any,
      aocc as any,
      ms as any,
      prisma as any,
      health as any,
      metrics as any,
    );
    return { svc, aocc };
  }

  it('extrai via Playwright completo quando a fonte não tem extractHttp', async () => {
    const { svc, aocc } = makePlaywrightSvc();
    const page = makePageMock({});
    const { browser, context } = makeBrowserMock([page]);
    launchMock.mockResolvedValue(browser as any);
    const res = await svc.scrapeEpisodeVideo(
      'https://animesonlinecc.to/ep/1',
      undefined,
      false,
    );
    expect(res.videos).toEqual(['https://cdn.playwright/v.mp4']);
    expect(launchMock).toHaveBeenCalledWith({
      headless: true,
      chromiumSandbox: false,
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://animesonlinecc.to/ep/1',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
    expect(aocc.extract).toHaveBeenCalledWith(page);
    expect(context.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it('aborta com ServiceUnavailableException quando detecta Cloudflare', async () => {
    const { svc } = makePlaywrightSvc();
    const page = makePageMock({
      title: 'Just a moment, checking your browser',
    });
    const { browser } = makeBrowserMock([page]);
    launchMock.mockResolvedValue(browser as any);
    await expect(
      svc.scrapeEpisodeVideo(
        'https://animesonlinecc.to/ep/cf',
        undefined,
        false,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('segue a extração mesmo sem player aparente ou com evaluate falho', async () => {
    const { svc } = makePlaywrightSvc();
    const page = makePageMock({});
    page.waitForSelector.mockRejectedValue(new Error('no selector'));
    page.evaluate.mockRejectedValue(new Error('context destroyed'));
    const { browser } = makeBrowserMock([page]);
    launchMock.mockResolvedValue(browser as any);
    const res = await svc.scrapeEpisodeVideo(
      'https://animesonlinecc.to/ep/tough',
      undefined,
      false,
    );
    expect(res.videos).toEqual(['https://cdn.playwright/v.mp4']);
  });

  it('tenta estado visible quando attached não acha o player', async () => {
    const { svc } = makePlaywrightSvc();
    const page = makePageMock({});
    page.waitForSelector
      .mockRejectedValueOnce(new Error('attached timeout'))
      .mockResolvedValueOnce(undefined);
    const { browser } = makeBrowserMock([page]);
    launchMock.mockResolvedValue(browser as any);
    const res = await svc.scrapeEpisodeVideo(
      'https://animesonlinecc.to/ep/visible',
      undefined,
      false,
    );
    expect(res.videos).toEqual(['https://cdn.playwright/v.mp4']);
    expect(page.waitForSelector).toHaveBeenCalledTimes(2);
  });

  it('trata title que falha como não-bloqueado no detectCloudflare', async () => {
    const { svc } = makePlaywrightSvc();
    const page = makePageMock({});
    page.title.mockRejectedValue(new Error('nav error'));
    const { browser } = makeBrowserMock([page]);
    launchMock.mockResolvedValue(browser as any);
    const res = await svc.scrapeEpisodeVideo(
      'https://animesonlinecc.to/ep/titlefail',
      undefined,
      false,
    );
    expect(res.videos).toEqual(['https://cdn.playwright/v.mp4']);
  });

  it('extractPlayerVideo retorna [] quando o goto falha', async () => {
    const { svc } = build();
    const page = makePageMock({});
    page.goto.mockRejectedValue(new Error('net error'));
    const context = {
      newPage: jest.fn(async () => page),
      close: jest.fn(async () => undefined),
    };
    const videos = await (svc as any).extractPlayerVideo(
      context,
      'https://player.test/1',
      'https://ep.test/1',
    );
    expect(videos).toEqual([]);
    expect(page.close).toHaveBeenCalled();
  });

  it('extractPlayerVideo clica em botões e captura só streams playable', async () => {
    const { svc } = build();
    const el = { click: jest.fn(async () => undefined) };
    const page = makePageMock({
      requestUrls: [
        'https://rr.googlevideo.com/videoplayback?x=1',
        'https://rr5.googlevideo.com/generate_204',
      ],
    });
    page.$.mockResolvedValue(el as any);
    const context = {
      newPage: jest.fn(async () => page),
      close: jest.fn(async () => undefined),
    };
    const videos = await (svc as any).extractPlayerVideo(
      context,
      'https://player.test/1',
      'https://ep.test/1',
    );
    expect(videos).toEqual(['https://rr.googlevideo.com/videoplayback?x=1']);
    expect(page.click).toHaveBeenCalledWith('body', expect.anything());
    expect(el.click).toHaveBeenCalled();
  });

  it('extractPlayerVideo clica em play dentro de child frames', async () => {
    const { svc } = build();
    const frameEl = { click: jest.fn(async () => undefined) };
    const frame = { $: jest.fn(async () => frameEl) };
    const page = makePageMock({});
    page.mainFrame.mockReturnValue({
      childFrames: jest.fn(() => [frame]),
    } as any);
    page.isClosed.mockReturnValue(true);
    const context = {
      newPage: jest.fn(async () => page),
      close: jest.fn(async () => undefined),
    };
    const videos = await (svc as any).extractPlayerVideo(
      context,
      'https://player.test/1',
      'https://ep.test/1',
    );
    expect(frameEl.click).toHaveBeenCalled();
    expect(videos).toEqual([]);
  });

  it('wrap usa API_PREFIX custom e preserva referer', async () => {
    process.env.API_PREFIX = 'v1';
    const { svc } = build();
    const wrapped = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/prefix',
      undefined,
      true,
    );
    expect(wrapped.videos[0]).toMatch(/^\/v1\/embed\/media\?url=/);
  });

  it('wrap preserva URLs relativas e vazias intactas', async () => {
    const { svc, af } = build();
    af.extractHttp.mockResolvedValueOnce({
      videos: ['', '/local/v.mp4', 'https://cdn.test/v.mp4'],
      iframes: [],
      cloudflare: false,
    });
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/rel',
      undefined,
      true,
    );
    expect(res.videos[0]).toBe('');
    expect(res.videos[1]).toBe('/local/v.mp4');
    expect(res.videos[2]).toBe(
      '/api/embed/media?url=https%3A%2F%2Fcdn.test%2Fv.mp4&referer=https%3A%2F%2Fcdn.test',
    );
  });

  it('wrap preserva playerTokens e cloudflare', async () => {
    const { svc, af } = build();
    af.extractHttp.mockResolvedValueOnce({
      videos: ['https://cdn.test/v.mp4'],
      iframes: [],
      cloudflare: true,
      playerTokens: ['https://www.youtube-nocookie.com/embed/0YpXN40vIxM'],
    });
    const res = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/wt',
      undefined,
      true,
    );
    expect(res.cloudflare).toBe(false);
    expect(res.playerTokens).toEqual([
      'https://www.youtube-nocookie.com/embed/0YpXN40vIxM',
    ]);
  });

  it('reextract retorna null quando o anime não existe', async () => {
    const { svc, prisma } = build();
    prisma.anime.findUnique.mockResolvedValue(null as any);
    expect(await svc.reextractEpisodeVideo('nao-existe', 1)).toBeNull();
  });

  it('reextract retorna null quando o episódio não existe ou sem embedUrl', async () => {
    const { svc, prisma } = build();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.episode.findUnique.mockResolvedValue(null as any);
    expect(await svc.reextractEpisodeVideo('x', 1)).toBeNull();

    prisma.episode.findUnique.mockResolvedValue({
      id: 'e1',
      embedUrl: null,
    } as any);
    expect(await svc.reextractEpisodeVideo('x', 1)).toBeNull();
  });

  it('reextract retorna null quando nenhuma fonte HTTP suporta a URL', async () => {
    const { svc, prisma } = build();
    prisma.episode.findUnique.mockResolvedValue({
      id: 'e1',
      embedUrl: 'https://desconhecido.test/x',
    });
    expect(await svc.reextractEpisodeVideo('x', 1)).toBeNull();
  });

  it('reextract registra failure e retorna null quando extractHttp lança', async () => {
    const { svc, prisma, af, health } = build();
    prisma.episode.findUnique.mockResolvedValue({
      id: 'e1',
      embedUrl: 'https://animefire.io/animes/x/1',
    });
    af.extractHttp.mockRejectedValueOnce(new Error('boom'));
    expect(await svc.reextractEpisodeVideo('x', 1)).toBeNull();
    expect(health.recordFailure).toHaveBeenCalledWith('animefire');
  });

  it('reextract retorna null quando extração HTTP devolve sem vídeo', async () => {
    const { svc, prisma, af, health } = build();
    prisma.episode.findUnique.mockResolvedValue({
      id: 'e1',
      embedUrl: 'https://animefire.io/animes/x/1',
    });
    af.extractHttp.mockResolvedValueOnce({
      videos: [],
      iframes: [],
      cloudflare: false,
    });
    expect(await svc.reextractEpisodeVideo('x', 1)).toBeNull();
    expect(health.recordFailure).toHaveBeenCalledWith('animefire');
  });

  it('monta URL de episódio do meusanimes', () => {
    const { svc } = build();
    expect(svc.meusanimesEpisodeUrl('kaguya-sama', 2, 1)).toBe(
      'https://meusanimes.blog/e/kaguya-sama-episodio-2/',
    );
    expect(svc.meusanimesEpisodeUrl('kaguya-sama', 2)).toBe(
      'https://meusanimes.blog/e/kaguya-sama-episodio-2/',
    );
  });

  it('scrapeFromMeusanimes tenta candidatos até achar vídeo', async () => {
    const { svc } = build();
    const spy = jest
      .spyOn(svc, 'scrapeEpisodeVideo')
      .mockResolvedValueOnce({
        videos: [],
        iframes: [],
        cloudflare: false,
      })
      .mockResolvedValueOnce({
        videos: ['https://cdn.meusanimes/v.mp4'],
        iframes: [],
        cloudflare: false,
      });
    const v = await svc.scrapeFromMeusanimes('foo', 1, 1);
    expect(v).toBe('https://cdn.meusanimes/v.mp4');
    expect(spy).toHaveBeenNthCalledWith(
      1,
      'https://meusanimes.blog/e/foo-episodio-1/',
      undefined,
      false,
    );
    expect(spy).toHaveBeenNthCalledWith(
      2,
      'https://meusanimes.blog/e/foo/',
      undefined,
      false,
    );
  });

  it('scrapeFromMeusanimes retorna null quando todos os candidatos falham', async () => {
    const { svc } = build();
    const spy = jest
      .spyOn(svc, 'scrapeEpisodeVideo')
      .mockRejectedValue(new Error('down'));
    expect(await svc.scrapeFromMeusanimes('foo', 1)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('invalidateEpisode remove apenas entradas da URL informada', async () => {
    const { svc } = build();
    await svc.scrapeEpisodeVideo('https://animefire.io/a/9', undefined, false);
    await svc.scrapeEpisodeVideo('https://animefire.io/b/9', undefined, false);
    const cache = (svc as any).cache as Map<string, any>;
    expect(cache.size).toBe(2);
    svc.invalidateEpisode('https://animefire.io/a/9');
    expect(cache.has('scrape:animefire:https://animefire.io/a/9')).toBe(false);
    expect(cache.has('scrape:animefire:https://animefire.io/b/9')).toBe(true);
  });

  it('evicta a entrada mais antiga quando o cache estoura', () => {
    const { svc } = build();
    const cache = (svc as any).cache as Map<string, any>;
    for (let i = 0; i < 201; i++) {
      cache.set(`scrape:animefire:https://cdn.test/${i}`, {
        result: { videos: [], iframes: [], cloudflare: false },
        fetchedAt: 1000 + i,
        expiresAt: 100_000 + i,
      });
    }
    (svc as any).evictIfNeeded();
    expect(cache.size).toBe(200);
    expect(cache.has('scrape:animefire:https://cdn.test/0')).toBe(false);
  });
});
