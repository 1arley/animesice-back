import { EpisodeResolution } from '@/watchtower/episode-resolution.service';
import { SOURCE_IDS } from '@/watchtower/watchtower.types';
import * as mediaProbe from '@/common/media-probe';

jest.mock('@/common/ssrf', () => ({
  resolveSafeUrl: jest.fn(async (url: string) => ({ url })),
  pinnedDispatcher: jest.fn(() => ({ close: jest.fn() })),
}));

function makeMocks() {
  const existingEpisode = new Map<string, boolean>();
  const episodeStore = new Map<string, any>();
  const animeStore = new Map<string, any>();
  const scrapeResults = new Map<string, string[]>();

  const prisma = {
    episode: {
      findUnique: jest.fn(async (args: any) => {
        if (args?.where?.id) {
          for (const row of episodeStore.values()) {
            if (row.id === args.where.id) return row;
          }
          return null;
        }
        const w = args?.where?.animeId_season_number;
        if (!w) return null;
        const key = `${w.animeId}:${w.season}:${w.number}`;
        if (episodeStore.has(key)) return episodeStore.get(key);
        return existingEpisode.get(key)
          ? {
              id: 'ep-exists',
              animeId: w.animeId,
              season: w.season,
              number: w.number,
            }
          : null;
      }),
      upsert: jest.fn(async (args: any) => {
        const w = args.where.animeId_season_number;
        const key = `${w.animeId}:${w.season}:${w.number}`;
        const row = {
          id: 'ep-' + key,
          animeId: w.animeId,
          season: w.season,
          number: w.number,
          ...args.create,
          ...args.update,
        };
        episodeStore.set(key, row);
        return row;
      }),
      update: jest.fn(
        async (args: any) =>
          episodeStore.get(args.where.id) ?? {
            id: args.where.id,
            ...args.data,
          },
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn(async () => 0),
    },
    episodeSource: {
      upsert: jest.fn(async () => ({})),
    },
    anime: {
      findUnique: jest.fn(
        async (args: any) =>
          animeStore.get(args.where.id) ??
          animeStore.get(args.where.slug) ??
          null,
      ),
      update: jest.fn(async (args: any) => ({
        id: args.where.id,
        ...args.data,
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };

  const health = {
    rankedSources: jest.fn(async () => ['meusanimes', 'animesonline']),
    isDisabled: jest.fn(async () => false),
    recordSuccess: jest.fn(async () => undefined),
    recordFailure: jest.fn(async () => undefined),
    reviveOne: jest.fn(async () => null),
  };

  const scrape = {
    resolveCandidateUrlsForSource: jest.fn().mockResolvedValue([]),
    scrapeEpisodeVideo: jest.fn(async (url: string, sourceId: string) => {
      const videos =
        scrapeResults.get(sourceId) ?? scrapeResults.get(url) ?? [];
      return { videos, iframes: [], cloudflare: false };
    }),
  };

  const notifications = {
    notifyNewEpisode: jest.fn(async () => [{ id: 'n1' }]),
  };

  const resolution = new EpisodeResolution(
    prisma as any,
    scrape as any,
    health as any,
    notifications as any,
  );

  return {
    existingEpisode,
    episodeStore,
    animeStore,
    scrapeResults,
    prisma,
    health,
    scrape,
    notifications,
    resolution,
  };
}

describe('EpisodeResolution', () => {
  let m: ReturnType<typeof makeMocks>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    m = makeMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('candidate discovery', () => {
    it('exactCandidate só devolve quando a fonte bate com o host', () => {
      expect(
        m.resolution.exactCandidate(
          'https://meusanimes.blog/a/bleach/',
          'meusanimes',
        ),
      ).toEqual({
        sourceId: 'meusanimes',
        url: 'https://meusanimes.blog/a/bleach/',
      });
      expect(
        m.resolution.exactCandidate(
          'https://meusanimes.blog/a/bleach/',
          'animefire',
        ),
      ).toBeNull();
      expect(
        m.resolution.exactCandidate(
          'https://desconhecido.test/e/1',
          'meusanimes',
        ),
      ).toBeNull();
    });

    it('candidates retorna ordem de health quando URLs respondem', async () => {
      global.fetch = jest.fn(async () => ({
        status: 200,
        body: { cancel: jest.fn() },
      })) as any;
      const result = await m.resolution.candidates('solo-leveling', 1);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]!.sourceId).toBe('meusanimes');
    });

    it('candidates usa resolveCandidateUrlsForSource do ScrapeService quando disponível', async () => {
      m.scrape.resolveCandidateUrlsForSource.mockImplementation(
        async (sourceId: string) =>
          sourceId === 'topanimes'
            ? ['https://topanimes.net/episodio/listagem-real-episodio-4/']
            : [],
      );
      m.health.rankedSources.mockResolvedValue(['topanimes']);
      global.fetch = jest.fn(async () => ({
        status: 200,
        body: { cancel: jest.fn() },
      })) as any;

      const result = await m.resolution.candidates('slug-qualquer', 4);
      expect(result).toEqual([
        {
          sourceId: 'topanimes',
          url: 'https://topanimes.net/episodio/listagem-real-episodio-4/',
        },
      ]);
    });

    it('candidates exclui fonte cuja URL retorna 404 em todos os templates', async () => {
      global.fetch = jest.fn(async () => ({ status: 404 }) as any);
      const result = await m.resolution.candidates('solo-leveling', 1);
      expect(result).toHaveLength(0);
    });

    it('candidates inclui fonte bloqueada (403) ou erro de rede como fallback', async () => {
      global.fetch = jest.fn(async (url: string) => {
        if (url.includes('meusanimes')) return { status: 403 } as any;
        throw new Error('network error');
      }) as any;
      const result = await m.resolution.candidates('solo-leveling', 1);
      expect(result.map((r) => r.sourceId)).toEqual([
        'meusanimes',
        'animesonline',
      ]);
    });

    it('allCandidates retorna todas as fontes e inclui variante sem sufixo dublado', () => {
      const result = m.resolution.allCandidates('bleach-dublado-2', 7);
      expect(result.length).toBeGreaterThanOrEqual(SOURCE_IDS.length);
      const urls = result.map((c) => c.url);
      expect(urls).toContain(
        'https://meusanimes.blog/e/bleach-dublado-2-episodio-7/',
      );
      expect(urls).toContain('https://meusanimes.blog/e/bleach-episodio-7/');
    });

    it('candidates prioriza episodeUrl explícito e descarta se retornar 404', async () => {
      const realUrl = 'https://meusanimes.blog/e/kaguya-sama-episodio-3/';
      global.fetch = jest.fn(async () => ({ status: 200 }) as any);
      const hit = await m.resolution.candidates('kaguya-sama', 3, 1, realUrl);
      expect(hit[0]).toEqual({ sourceId: 'meusanimes', url: realUrl });

      global.fetch = jest.fn(async (url: string) =>
        url === realUrl ? ({ status: 404 } as any) : ({ status: 200 } as any),
      ) as any;
      const miss = await m.resolution.candidates('kaguya-sama', 3, 1, realUrl);
      expect(miss.find((c) => c.url === realUrl)).toBeUndefined();
    });
  });

  describe('extraction & validation', () => {
    it('extract extrai vídeo e tenta próxima fonte quando a primeira falha', async () => {
      global.fetch = jest.fn(async () => ({ status: 200 }) as any);
      m.scrapeResults.set('animesonline', ['https://cdn2.test/v2.mp4']);
      const { candidates, triedSources } = await m.resolution.extract(
        'solo',
        1,
      );
      expect(triedSources).toEqual(['meusanimes', 'animesonline']);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.sourceId).toBe('animesonline');
    });

    it('extractExact raspa só a fonte do handoff Rust e recusa fonte/host divergente', async () => {
      m.scrapeResults.set('meusanimes', ['https://cdn.test/rust.mp4']);
      const { candidates, triedSources } = await m.resolution.extractExact(
        'meusanimes',
        'https://meusanimes.blog/e/bleach-1-episodio-1/',
        'meusanimes',
      );
      expect(triedSources).toEqual(['meusanimes']);
      expect(candidates[0]!.videoUrl).toBe('https://cdn.test/rust.mp4');

      await expect(
        m.resolution.extractExact(
          'meusanimes',
          'https://animefire.io/animes/solo/1',
          'meusanimes',
        ),
      ).rejects.toThrow('incompatíveis');
    });

    it('pickValidSources retém fontes distintas com mídia viva e faz fallback p/ capa do anime', async () => {
      m.animeStore.set('anime-1', { coverImage: 'https://img.test/cover.jpg' });
      const future = Math.floor(Date.now() / 1000) + 7200;
      const result = await m.resolution.pickValidSources(
        [
          {
            videoUrl: `https://rr1---sn-x.googlevideo.com/videoplayback?expire=${future}&id=one`,
            sourceId: 'meusanimes',
            embedUrl: 'https://meusanimes.blog/e/anime-episodio-1/',
          },
          {
            videoUrl: `https://rr1---sn-x.googlevideo.com/videoplayback?expire=${future}&id=two`,
            sourceId: 'meusanimes',
            embedUrl: 'https://meusanimes.blog/e/anime-episodio-1/',
          },
          {
            videoUrl: `https://rr1---sn-x.googlevideo.com/videoplayback?expire=${future}&id=three`,
            sourceId: 'animesorion',
            embedUrl: 'https://animesorion.cc/episodios/anime-1x1/',
          },
        ],
        'anime-1',
      );
      expect(result.map((s) => s.sourceId)).toEqual([
        'meusanimes',
        'animesorion',
      ]);
      expect(result[0]!.thumbnailUrl).toBe('https://img.test/cover.jpg');
    });
  });

  describe('publication & anime publish state machine', () => {
    it('publish faz upsert de Episode + EpisodeSource, republica anime despublicado e notifica apenas inéditos', async () => {
      m.animeStore.set('anime-1', {
        id: 'anime-1',
        slug: 'solo',
        title: 'Solo Leveling',
        audio: 'LEGENDADO',
      });
      await m.resolution.publish({
        animeId: 'anime-1',
        episodeNumber: 1,
        videoUrl: 'https://v.test/1.mp4',
        embedUrl: 'https://meusanimes.blog/e/solo-episodio-1/',
        sourceId: 'meusanimes',
      });
      expect(m.prisma.episode.upsert).toHaveBeenCalledTimes(1);
      expect(m.prisma.episodeSource.upsert).toHaveBeenCalledTimes(1);
      expect(m.prisma.anime.updateMany).toHaveBeenCalledWith({
        where: { id: 'anime-1', published: false },
        data: {
          published: true,
          catalogUnpublished: false,
          catalogAbsentChecks: 0,
          catalogAbsenceCheckedAt: null,
        },
      });
      expect(m.notifications.notifyNewEpisode).toHaveBeenCalledTimes(1);

      m.existingEpisode.set('anime-1:1:1', true);
      await m.resolution.publish({
        animeId: 'anime-1',
        episodeNumber: 1,
        videoUrl: 'https://v.test/1-new.mp4',
        embedUrl: 'https://meusanimes.blog/e/solo-episodio-1/',
        sourceId: 'meusanimes',
      });
      expect(m.notifications.notifyNewEpisode).toHaveBeenCalledTimes(1);
    });

    it('unpublishIfFullyBroken despublica anime quando nenhum episódio tem vídeo vivo', async () => {
      m.animeStore.set('anime-1', { id: 'anime-1', published: true });
      m.prisma.episode.count.mockResolvedValueOnce(0);
      await m.resolution.unpublishIfFullyBroken('anime-1');
      expect(m.prisma.anime.update).toHaveBeenCalledWith({
        where: { id: 'anime-1' },
        data: { published: false, catalogUnpublished: true },
      });
    });

    it('resolveAndPublish executa fluxo completo de extract e de repair', async () => {
      jest.spyOn(mediaProbe, 'probeMediaUrlDead').mockResolvedValue(false);
      global.fetch = jest.fn(async () => ({ status: 200 }) as any);
      m.animeStore.set('anime-1', {
        id: 'anime-1',
        slug: 'solo',
        title: 'Solo Leveling',
        coverImage: 'cover.jpg',
        audio: 'LEGENDADO',
        published: true,
      });
      m.scrapeResults.set('meusanimes', ['https://cdn.test/v1.mp4']);

      await m.resolution.resolveAndPublish({
        animeId: 'anime-1',
        slug: 'solo',
        episodeNumber: 1,
        mode: 'extract',
      });

      expect(m.prisma.episode.upsert).toHaveBeenCalledTimes(1);
      expect(m.episodeStore.get('anime-1:1:1')?.videoUrl).toBe(
        'https://cdn.test/v1.mp4',
      );
    });

    it('resolveAndPublish em modo extract trata anime ausente, falta de fontes e falha de validação', async () => {
      await expect(
        m.resolution.resolveAndPublish({
          animeId: 'missing',
          slug: 'missing',
          episodeNumber: 1,
          mode: 'extract',
        }),
      ).rejects.toThrow(/não encontrado/);

      m.animeStore.set('anime-1', {
        id: 'anime-1',
        slug: 'solo',
        title: 'Solo',
        coverImage: 'cover.jpg',
        audio: 'LEGENDADO',
        published: true,
      });
      global.fetch = jest.fn(async () => ({ status: 404 }) as any);

      await expect(
        m.resolution.resolveAndPublish({
          animeId: 'anime-1',
          slug: 'solo',
          episodeNumber: 1,
          mode: 'extract',
        }),
      ).rejects.toThrow(/Nenhuma fonte resolveu/);
      expect(m.prisma.episode.updateMany).toHaveBeenCalled();

      global.fetch = jest.fn(async () => ({ status: 200 }) as any);
      m.scrapeResults.set('meusanimes', ['https://cdn.test/dead.mp4']);
      jest.spyOn(mediaProbe, 'probeMediaUrlDead').mockResolvedValue(true);

      await expect(
        m.resolution.resolveAndPublish({
          animeId: 'anime-1',
          slug: 'solo',
          episodeNumber: 1,
          mode: 'extract',
        }),
      ).rejects.toThrow(/Validação falhou/);
      expect(m.health.recordFailure).toHaveBeenCalledWith(
        'meusanimes',
        expect.objectContaining({ kind: 'VALIDATION' }),
      );
    });

    it('resolveAndPublish em modo repair cobre episódio ausente, vídeo ainda vivo, rustFallbackUrl e falhas de extração/validação', async () => {
      m.animeStore.set('anime-1', {
        id: 'anime-1',
        slug: 'solo',
        title: 'Solo',
        coverImage: 'cover.jpg',
        audio: 'LEGENDADO',
        published: true,
      });
      global.fetch = jest.fn(async () => ({ status: 200 }) as any);
      jest.spyOn(mediaProbe, 'probeMediaUrlDead').mockResolvedValue(false);
      m.scrapeResults.set('meusanimes', ['https://cdn.test/v1.mp4']);

      // 1. Episódio ainda não existe -> delega para extract
      await m.resolution.resolveAndPublish({
        animeId: 'anime-1',
        episodeNumber: 1,
        mode: 'repair',
      });
      expect(m.episodeStore.get('anime-1:1:1')?.videoUrl).toBe(
        'https://cdn.test/v1.mp4',
      );

      // 2. Episódio existe e vídeo atual está vivo -> apenas limpa videoBroken
      await m.resolution.resolveAndPublish({
        animeId: 'anime-1',
        episodeNumber: 1,
        mode: 'repair',
      });
      expect(m.prisma.episode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ videoBroken: false }),
        }),
      );

      // 3. Vídeo morto + rustFallbackUrl -> reextrai via extractExact e publica
      m.episodeStore.set('anime-1:1:1', {
        id: 'ep-1',
        animeId: 'anime-1',
        season: 1,
        number: 1,
        videoUrl: null,
        embedUrl: 'https://meusanimes.blog/e/solo-episodio-1/',
      });
      m.scrapeResults.set('animesonline', ['https://cdn.test/repaired.mp4']);
      await m.resolution.resolveAndPublish({
        animeId: 'anime-1',
        episodeNumber: 1,
        rustFallbackUrl: 'https://animesonline.cloud/episodio/solo-episodio-1',
        rustFallbackSourceId: 'animesonline',
        mode: 'repair',
      });
      expect(m.episodeStore.get('anime-1:1:1')?.videoUrl).toBe(
        'https://cdn.test/repaired.mp4',
      );

      // 4. Repair falha quando nenhuma fonte retorna candidatos
      m.episodeStore.set('anime-1:1:2', {
        id: 'ep-2',
        animeId: 'anime-1',
        season: 1,
        number: 2,
        videoUrl: null,
        embedUrl: null,
      });
      global.fetch = jest.fn(async () => ({ status: 404 }) as any);
      await expect(
        m.resolution.resolveAndPublish({
          animeId: 'anime-1',
          episodeNumber: 2,
          mode: 'repair',
        }),
      ).rejects.toThrow(/Repair: sem fonte/);

      // 5. Repair falha quando validação rejeita todos os vídeos
      global.fetch = jest.fn(async () => ({ status: 200 }) as any);
      m.scrapeResults.set('meusanimes', ['https://cdn.test/dead-repair.mp4']);
      jest.spyOn(mediaProbe, 'probeMediaUrlDead').mockResolvedValue(true);
      await expect(
        m.resolution.resolveAndPublish({
          animeId: 'anime-1',
          episodeNumber: 2,
          mode: 'repair',
        }),
      ).rejects.toThrow(/Repair: validação falhou/);
    });

    it('markAnimeComplete, pickValid, fallbackEmbedUrl e explicitCandidate cobrem todos os provedores e falhas toleradas', async () => {
      await m.resolution.markAnimeComplete('anime-1');
      expect(m.prisma.anime.update).toHaveBeenCalledWith({
        where: { id: 'anime-1' },
        data: { status: 'FINALIZADO' },
      });

      m.prisma.anime.update.mockRejectedValueOnce(new Error('db fail'));
      await expect(
        m.resolution.markAnimeComplete('anime-1'),
      ).resolves.toBeUndefined();

      m.prisma.episode.updateMany.mockRejectedValueOnce(new Error('db fail'));
      m.animeStore.set('anime-1', { id: 'anime-1', published: true });
      m.prisma.episode.count.mockResolvedValueOnce(0);
      m.prisma.anime.update.mockRejectedValueOnce(new Error('db fail'));
      await expect(
        m.resolution.markEpisodeBrokenIfAny('anime-1', 1, 1),
      ).resolves.toBeUndefined();

      jest.spyOn(mediaProbe, 'probeMediaUrlDead').mockResolvedValue(false);
      await expect(
        m.resolution.pickValid(
          [{ videoUrl: 'https://cdn.test/v.mp4', sourceId: 'meusanimes' }],
          'anime-1',
        ),
      ).resolves.toEqual(
        expect.objectContaining({ videoUrl: 'https://cdn.test/v.mp4' }),
      );

      const resAny = m.resolution as any;
      expect(resAny.fallbackEmbedUrl('animefire', 'solo', 2, 1)).toBe(
        'https://animefire.io/animes/solo/2',
      );
      expect(resAny.fallbackEmbedUrl('meusanimes', 'solo', 2, 1)).toBe(
        'https://meusanimes.blog/e/solo-episodio-2/',
      );

      expect(
        resAny.explicitCandidate('https://animefire.io/animes/solo/1'),
      ).toEqual({
        sourceId: 'animefire',
        url: 'https://animefire.io/animes/solo/1',
      });
      expect(
        resAny.explicitCandidate(
          'https://animesonline.cloud/episodio/solo-episodio-1',
        ),
      ).toEqual({
        sourceId: 'animesonline',
        url: 'https://animesonline.cloud/episodio/solo-episodio-1',
      });
      expect(
        resAny.explicitCandidate('https://animesdigital.org/video/a/1'),
      ).toEqual({
        sourceId: 'animesdigital',
        url: 'https://animesdigital.org/video/a/1',
      });
      expect(
        resAny.explicitCandidate('https://topanimes.net/episodio/solo-1/'),
      ).toEqual({
        sourceId: 'topanimes',
        url: 'https://topanimes.net/episodio/solo-1/',
      });
      expect(
        resAny.explicitCandidate('https://animesorion.cc/episodios/solo-1x1/'),
      ).toEqual({
        sourceId: 'animesorion',
        url: 'https://animesorion.cc/episodios/solo-1x1/',
      });
      expect(
        resAny.explicitCandidate('https://unknown.example/ep/1'),
      ).toBeNull();
    });
  });
});
