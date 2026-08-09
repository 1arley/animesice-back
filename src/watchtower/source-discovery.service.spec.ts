import { SourceDiscovery } from '@/watchtower/source-discovery.service';

function makeMockHealth() {
  return {
    rankedSources: jest.fn(async () => [
      'meusanimes',
      'animefire',
      'animesonlinecc',
    ]),
    recordSuccess: jest.fn(async () => undefined),
    recordFailure: jest.fn(async () => undefined),
    reviveOne: jest.fn(async () => null),
  };
}

function makeFetchMock(statusByPattern: Record<string, number>) {
  const entries = Object.entries(statusByPattern);
  return jest.fn(async (url: string) => {
    for (const [pattern, status] of entries) {
      if (url.includes(pattern)) {
        return {
          status,
          body: { cancel: jest.fn(async () => undefined) },
        } as any;
      }
    }
    return { status: 200, body: { cancel: jest.fn() } } as any;
  });
}

describe('SourceDiscovery', () => {
  let health: ReturnType<typeof makeMockHealth>;
  let discovery: SourceDiscovery;

  beforeEach(() => {
    health = makeMockHealth();
    discovery = new SourceDiscovery(health as any);
  });

  it('candidates retorna ordem de health quando URLs respondem', async () => {
    global.fetch = makeFetchMock({}) as any;
    const result = await discovery.candidates('solo-leveling', 1);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.sourceId).toBe('meusanimes');
  });

  it('candidates exclui fonte cuja URL retorna 404 em todos os templates', async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url.includes('meusanimes')) return { status: 404 } as any;
      if (url.includes('animefire')) return { status: 404 } as any;
      if (url.includes('animesonlinecc')) return { status: 404 } as any;
      return { status: 200 } as any;
    });
    global.fetch = fetchFn as any;
    const result = await discovery.candidates('solo-leveling', 1);
    expect(fetchFn).toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('candidates usa URL alternativa quando probe rejeita uma URL', async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url === 'https://meusanimes.blog/e/solo-leveling-1-episodio-1/') {
        return { status: 404 } as any;
      }
      return { status: 200 } as any;
    });
    global.fetch = fetchFn as any;
    const result = await discovery.candidates('solo-leveling', 1);
    const meusa = result.find((r) => r.sourceId === 'meusanimes');
    expect(meusa?.url).not.toContain('solo-leveling-1-episodio-1');
    expect(meusa?.url).toContain('meusanimes.blog');
  });

  it('candidates isola erro de rede e ainda inclui', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network error');
    }) as any;
    const result = await discovery.candidates('animes', 1);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.sourceId).toBe('meusanimes');
  });

  it('allCandidates retorna todas as fontes sem probe', () => {
    const result = discovery.allCandidates('anime-slug', 5);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.sourceId)).toContain('meusanimes');
    expect(result.map((c) => c.sourceId)).toContain('animefire');
    expect(result.map((c) => c.sourceId)).toContain('animesonlinecc');
  });

  it('URL meusanimes segue template <slug>-1-episodio-<n>/', () => {
    const result = discovery.allCandidates('mushoku-tensei', 7);
    const meusa = result.find((c) => c.sourceId === 'meusanimes');
    expect(meusa?.url).toBe(
      'https://meusanimes.blog/e/mushoku-tensei-1-episodio-7/',
    );
  });

  it('URL animefire segue template /animes/<slug>/<n>', () => {
    const result = discovery.allCandidates('solo-levelling', 3);
    const af = result.find((c) => c.sourceId === 'animefire');
    expect(af?.url).toBe('https://animefire.io/animes/solo-levelling/3');
  });
});
