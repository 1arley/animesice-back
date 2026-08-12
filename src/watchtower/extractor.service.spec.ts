import { Extractor } from '@/watchtower/extractor.service';

function makeMocks() {
  const scrapeResults = new Map<string, string[]>();
  const calls: string[] = [];
  return {
    calls,
    scrapeResults,
    callsLog: calls,
    scrape: {
      scrapeEpisodeVideo: jest.fn(async (url: string, sourceId: string) => {
        calls.push(sourceId);
        const videos =
          scrapeResults.get(sourceId) ?? scrapeResults.get(url) ?? [];
        return { videos, iframes: [], cloudflare: false };
      }),
    },
    discovery: {
      candidates: jest.fn(async (slug: string) => [
        {
          sourceId: 'meusanimes',
          url: `https://meusanimes.blog/e/${slug}-1-episodio-1/`,
        },
        { sourceId: 'animefire', url: `https://animefire.io/animes/${slug}/1` },
      ]),
    },
  };
}

describe('Extractor', () => {
  let m: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    m = makeMocks();
  });

  it('extrai vídeo da primeira fonte que responde', async () => {
    m.scrapeResults.set('meusanimes', ['https://cdn.test/v1.mp4']);
    const extractor = new Extractor(m.scrape as any, m.discovery as any);
    const { candidates } = await extractor.extract('solo-leveling', 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.videoUrl).toContain('cdn.test');
    expect(candidates[0]!.sourceId).toBe('meusanimes');
  });

  it('monta candidatos para todas as fontes válidas', async () => {
    m.scrapeResults.set('meusanimes', ['https://cdn.test/v1.mp4']);
    m.scrapeResults.set('animefire', ['https://cdn2.test/v2.mp4']);
    const extractor = new Extractor(m.scrape as any, m.discovery as any);
    const { candidates } = await extractor.extract('solo', 1);
    expect(candidates).toHaveLength(2);
  });

  it('tenta próxima fonte quando primeira falha', async () => {
    m.scrapeResults.set('animefire', ['https://cdn2.test/v2.mp4']);
    const extractor = new Extractor(m.scrape as any, m.discovery as any);
    const { candidates, triedSources } = await extractor.extract('solo', 1);
    expect(triedSources).toEqual(['meusanimes', 'animefire']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.sourceId).toBe('animefire');
  });

  it('retorna vazio quando todas as fontes lançam erro', async () => {
    const failingScrape = {
      scrapeEpisodeVideo: jest.fn(async () => {
        throw new Error('network timeout');
      }),
    };
    const extractor = new Extractor(failingScrape as any, m.discovery as any);
    const { candidates, triedSources } = await extractor.extract('solo', 1);
    expect(triedSources).toEqual(['meusanimes', 'animefire']);
    expect(candidates).toHaveLength(0);
  });

  it('chama scrapeEpisodeVideo com wrap=false', async () => {
    m.scrapeResults.set('meusanimes', ['https://cdn.test/v.mp4']);
    const extractor = new Extractor(m.scrape as any, m.discovery as any);
    await extractor.extract('solo', 1);
    const callArgs = m.scrape.scrapeEpisodeVideo.mock.calls[0] as unknown as [
      string,
      string,
      boolean?,
    ];
    expect(callArgs[0]).toContain('meusanimes.blog');
    expect(callArgs[1]).toBe('meusanimes');
    expect(callArgs[2]).toBe(false);
  });

  it('retorna vazio quando discovery não tem candidatos', async () => {
    const emptyDiscovery = { candidates: jest.fn(async () => []) };
    const extractor = new Extractor(m.scrape as any, emptyDiscovery as any);
    const { candidates, triedSources } = await extractor.extract('solo', 1);
    expect(candidates).toHaveLength(0);
    expect(triedSources).toHaveLength(0);
  });
});
