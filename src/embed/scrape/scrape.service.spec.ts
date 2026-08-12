import { ScrapeService } from '@/embed/scrape/scrape.service';
import type { ScrapeEpisodeResult } from '@/embed/scrape/scrape-source.interface';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeSource {
  id: string;
  supports: (url: string) => boolean;
  extract: jest.Mock;
  extractHttp: jest.Mock;
}

function makeSource(
  id: string,
  hosts: string[],
  videos: string[] = [`https://cdn.${id}.test/v.mp4`],
): FakeSource {
  return {
    id,
    supports: (url: string) => hosts.some((h) => url.includes(h)),
    extract: jest.fn(),
    extractHttp: jest.fn(async (): Promise<ScrapeEpisodeResult> => ({
      videos,
      iframes: [],
      cloudflare: false,
    })),
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

describe('ScrapeService (orquestração + cache SWR)', () => {
  const origTtl = process.env.SCRAPE_CACHE_TTL_MS;
  const origStale = process.env.SCRAPE_CACHE_STALE_MS;

  afterEach(() => {
    delete process.env.SCRAPE_CACHE_TTL_MS;
    delete process.env.SCRAPE_CACHE_STALE_MS;
  });

  afterAll(() => {
    if (origTtl === undefined) delete process.env.SCRAPE_CACHE_TTL_MS;
    else process.env.SCRAPE_CACHE_TTL_MS = origTtl;
    if (origStale === undefined) delete process.env.SCRAPE_CACHE_STALE_MS;
    else process.env.SCRAPE_CACHE_STALE_MS = origStale;
  });

  function build(opts?: { ttlMs?: number; staleMs?: number }) {
    if (opts?.ttlMs !== undefined) {
      process.env.SCRAPE_CACHE_TTL_MS = String(opts.ttlMs);
    }
    if (opts?.staleMs !== undefined) {
      process.env.SCRAPE_CACHE_STALE_MS = String(opts.staleMs);
    }
    const af = makeSource('animefire', ['animefire.io']);
    const aocc = makeSource('animesonlinecc', ['animesonlinecc.to']);
    const ms = makeSource('meusanimes', ['meusanimes.blog']);
    const prisma = makePrisma();
    const health = makeHealth();
    const svc = new ScrapeService(
      af as any,
      aocc as any,
      ms as any,
      prisma as any,
      health as any,
    );
    return { svc, af, aocc, ms, prisma, health };
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

    // Segunda chamada (mesma URL, wrap=false): cache hit, sem re-scrape,
    // e devolve RAW (o cache guarda sempre RAW).
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
    expect(af.extractHttp).toHaveBeenCalledTimes(2); // não foi cacheado
  });

  it('SWR: dentro da janela stale serve imediatamente e revalida em background', async () => {
    const { svc, af, health } = build({ ttlMs: 50, staleMs: 60_000 });
    const first = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/5',
      undefined,
      false,
    );
    await sleep(120); // ultrapassa o TTL fresco (50ms), entra na janela stale

    // Revalidação em background fica presa até liberarmos (deferred).
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
    // Serviu stale imediatamente (não esperou o fetch novo, ainda preso).
    expect(second.videos).toEqual(first.videos);
    expect(af.extractHttp).toHaveBeenCalledTimes(2); // revalidate já iniciou
    expect(second.videos[0]).not.toContain('cdn.fresh');

    // Libera o revalidate: cache é atualizado com o resultado fresco.
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
    await sleep(150); // além de fresh (30) e da janela stale (60)

    const second = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/6',
      undefined,
      false,
    );
    expect(second.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
    expect(health.recordSuccess).toHaveBeenCalledTimes(2);
  });

  it('degradação: fetch falha além da janela mas serve stale em vez de quebrar', async () => {
    const { svc, af, health } = build({ ttlMs: 30, staleMs: 60 });
    const first = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/7',
      undefined,
      false,
    );
    await sleep(150); // expirou além da janela stale

    af.extractHttp.mockRejectedValueOnce(new Error('provider down'));
    const second = await svc.scrapeEpisodeVideo(
      'https://animefire.io/a/7',
      undefined,
      false,
    );
    expect(second.videos).toEqual(first.videos); // degradou servindo stale
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
    await gate; // o fetch (único) começou
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

    await svc.scrapeEpisodeVideo(url, undefined, false); // popula cache (fetch 1)
    const fresh = await svc.reextractEpisodeVideo('x', 1, 1); // fetch 2
    expect(fresh).toContain('cdn.animefire');
    expect(health.recordSuccess).toHaveBeenCalledWith(
      'animefire',
      expect.any(Number),
    );

    // cache foi invalidado e semeado: próxima chamada não re-scrape
    const again = await svc.scrapeEpisodeVideo(url, undefined, false);
    expect(again.videos[0]).toContain('cdn.animefire');
    expect(af.extractHttp).toHaveBeenCalledTimes(2);
  });
});
