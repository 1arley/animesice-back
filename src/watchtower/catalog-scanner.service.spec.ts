import { CatalogScanner } from './catalog-scanner.service';
import { JOB_TYPE } from './watchtower.types';

function makeMocks() {
  return {
    prisma: {
      anime: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      episode: {
        findMany: jest.fn(),
      },
      animeSource: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    },
    jobs: {
      enqueue: jest.fn(),
      enqueueMany: jest.fn(),
    },
  };
}

interface FakeEntry {
  season: number;
  episode: number;
  url: string;
}

/** Scan resolvido do meusanimes (fonte base). */
function meusaScan(entries: FakeEntry[]) {
  return { sourceId: 'meusanimes', sourceSlug: 'test', entries };
}

describe('CatalogScanner', () => {
  let m: ReturnType<typeof makeMocks>;
  let scanner: CatalogScanner;

  beforeEach(() => {
    m = makeMocks();
    scanner = new CatalogScanner(m.prisma as any, m.jobs as any);
    jest.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('executa sem erro', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation();
      scanner.onModuleInit();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('scanAll', () => {
    it('retorna 0 quando não há animes', async () => {
      m.prisma.anime.findMany.mockResolvedValue([]);
      const result = await scanner.scanAll();
      expect(result).toEqual({ scanned: 0, enqueued: 0 });
    });

    it('escaneia animes com gap de episódios', async () => {
      m.prisma.anime.findMany.mockResolvedValue([
        {
          id: 'a1',
          slug: 'anime-1',
          title: 'Test',
          episodeCount: 10,
          _count: { episodes: 5 },
        },
      ]);
      const result = await scanner.scanAll();
      expect(result.scanned).toBe(1);
      expect(result.enqueued).toBe(1);
      expect(m.jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: JOB_TYPE.SCAN_CATALOG,
          payload: { animeId: 'a1', slug: 'anime-1' },
        }),
      );
    });

    it('pula animes com episódios completos sem force', async () => {
      m.prisma.anime.findMany.mockResolvedValue([
        {
          id: 'a1',
          slug: 'anime-1',
          title: 'Test',
          episodeCount: 10,
          _count: { episodes: 10 },
        },
      ]);
      const result = await scanner.scanAll(false);
      expect(result.scanned).toBe(0);
      expect(result.enqueued).toBe(0);
    });

    it('escaneia tudo com force=true mesmo se completo', async () => {
      m.prisma.anime.findMany.mockResolvedValue([
        {
          id: 'a1',
          slug: 'anime-1',
          title: 'Test',
          episodeCount: 10,
          _count: { episodes: 10 },
        },
      ]);
      const result = await scanner.scanAll(true);
      expect(result.scanned).toBe(1);
      expect(result.enqueued).toBe(1);
    });

    it('escaneia anime com episodeCount null e 0 episódios no DB', async () => {
      m.prisma.anime.findMany.mockResolvedValue([
        {
          id: 'a1',
          slug: 'anime-1',
          title: 'Test',
          episodeCount: null,
          _count: { episodes: 0 },
        },
      ]);
      const result = await scanner.scanAll(false);
      expect(result.scanned).toBe(1);
      expect(result.enqueued).toBe(1);
    });

    it('pula anime com episodeCount null mas 1+ episódios sem force', async () => {
      m.prisma.anime.findMany.mockResolvedValue([
        {
          id: 'a1',
          slug: 'anime-1',
          title: 'Test',
          episodeCount: null,
          _count: { episodes: 2 },
        },
      ]);
      const result = await scanner.scanAll(false);
      expect(result.scanned).toBe(0);
      expect(result.enqueued).toBe(0);
    });
  });

  describe('scanAnime', () => {
    it('retorna episódios parseados do HTML', async () => {
      const html = `
        <div class="numerando">1 - 1</div>
        <div class="episodiotitle"><a href="https://meusanimes.blog/e/test-1-episodio-1/">Ep 1</a></div>
        <div class="numerando">1 - 2</div>
        <div class="episodiotitle"><a href="https://meusanimes.blog/e/test-1-episodio-2/">Ep 2</a></div>
      `;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(html),
      });

      const entries = await scanner.scanAnime('test-1');
      expect(entries.length).toBe(2);
      expect(entries[0]).toEqual({
        season: 1,
        episode: 1,
        url: 'https://meusanimes.blog/e/test-1-episodio-1/',
      });
      expect(entries[1]).toEqual({
        season: 1,
        episode: 2,
        url: 'https://meusanimes.blog/e/test-1-episodio-2/',
      });
    });

    it('retorna vazio quando fetch retorna erro', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
      const entries = await scanner.scanAnime('nonexistent');
      expect(entries).toEqual([]);
    });

    it('retorna vazio quando fetch falha na rede', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
      const entries = await scanner.scanAnime('test-1');
      expect(entries).toEqual([]);
    });

    it('retorna vazio quando HTML não tem episódios', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('<html><body>empty</body></html>'),
      });
      const entries = await scanner.scanAnime('test-1');
      expect(entries).toEqual([]);
    });

    it('tenta slug base quando slug com temporada retorna vazio', async () => {
      const emptyHtml = '<html><body>empty</body></html>';
      const entriesHtml = `
        <div class="numerando">1 - 1</div>
        <div class="episodiotitle"><a href="https://meusanimes.blog/e/test-1-episodio-1/">Ep 1</a></div>
      `;
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(emptyHtml),
          });
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(entriesHtml),
        });
      });

      const entries = await scanner.scanAnime('test-1-2');
      expect(entries.length).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('retorna vazio quando slug base já é o slug original', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('<html></html>'),
      });
      const entries = await scanner.scanAnime('test');
      expect(entries).toEqual([]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('remove duplicatas mantendo primeira ocorrência', async () => {
      const html = `
        <div class="numerando">1 - 1</div>
        <div class="episodiotitle"><a href="https://meusanimes.blog/e/test-episodio-1/">Ep 1</a></div>
        <div class="numerando">1 - 1</div>
        <div class="episodiotitle"><a href="https://meusanimes.blog/e/test-episodio-1-dup/">Ep 1 dup</a></div>
      `;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(html),
      });
      const entries = await scanner.scanAnime('test');
      expect(entries.length).toBe(1);
    });
  });

  describe('processScanCatalog', () => {
    beforeEach(() => {
      jest.spyOn(scanner, 'scanAnimeResolved' as any).mockResolvedValue(
        meusaScan([
          {
            season: 1,
            episode: 1,
            url: 'https://meusanimes.blog/e/test-episodio-1/',
          },
          {
            season: 1,
            episode: 2,
            url: 'https://meusanimes.blog/e/test-episodio-2/',
          },
        ]),
      );
    });

    it('retorna 0 quando scanAnime retorna vazio', async () => {
      (scanner as any).scanAnimeResolved = jest
        .fn()
        .mockResolvedValue(meusaScan([]));
      const result = await scanner.processScanCatalog('a1', 'test');
      expect(result).toEqual({ found: 0, missing: 0 });
    });

    it('enfileira episódios faltantes para season 1', async () => {
      m.prisma.anime.findUnique.mockResolvedValue({
        id: 'a1',
        slug: 'test',
        title: 'Test',
        synopsis: '',
        coverImage: null,
        bannerImage: null,
        ageRating: 'A14',
        status: 'LANCAMENTO',
        audio: 'LEGENDADO',
        format: 'TV',
        year: 2024,
        season: 'WINTER',
        studios: [],
        themes: [],
        alternativeTitles: [],
        published: true,
      });
      m.prisma.episode.findMany.mockResolvedValue([{ number: 1 }]);

      const result = await scanner.processScanCatalog('a1', 'test');
      expect(result.found).toBe(2);
      expect(result.missing).toBe(1);
      expect(m.jobs.enqueue).toHaveBeenCalledTimes(1);
    });

    it('meusanimes: externalKey segue derivado da URL do episódio (regressão)', async () => {
      // O catálogo do meusanimes inclui infixo de temporada na URL do episódio
      // ("<slug>-1-episodio-N"), então a chave persistida é "<slug>-1" — não o
      // slug da página /a/. Este comportamento não pode mudar.
      jest.spyOn(scanner, 'scanAnimeResolved' as any).mockResolvedValue(
        meusaScan([
          {
            season: 1,
            episode: 1,
            url: 'https://meusanimes.blog/e/yamada-kun-1-episodio-6/',
          },
        ]),
      );
      m.prisma.anime.findUnique.mockResolvedValue({
        id: 'a1',
        slug: 'yamada-kun',
        title: 'Yamada-kun',
        synopsis: '',
        coverImage: null,
        bannerImage: null,
        ageRating: 'A14',
        status: 'LANCAMENTO',
        audio: 'LEGENDADO',
        format: 'TV',
        year: 2024,
        season: 'WINTER',
        studios: [],
        themes: [],
        alternativeTitles: [],
        published: true,
      });
      m.prisma.episode.findMany.mockResolvedValue([]);

      await scanner.processScanCatalog('a1', 'yamada-kun');
      expect(m.prisma.animeSource.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            animeId_sourceId: { animeId: 'a1', sourceId: 'meusanimes' },
          },
          update: expect.objectContaining({
            externalUrl: 'https://meusanimes.blog/a/yamada-kun-1/',
            externalKey: 'yamada-kun-1',
          }),
        }),
      );
    });

    it('retorna 0 quando anime não encontrado no DB', async () => {
      m.prisma.anime.findUnique.mockResolvedValue(null);
      const result = await scanner.processScanCatalog('a1', 'test');
      expect(result).toEqual({ found: 0, missing: 0 });
    });

    it('cria sibling anime para season 2+', async () => {
      jest.spyOn(scanner, 'scanAnimeResolved' as any).mockResolvedValue(
        meusaScan([
          {
            season: 2,
            episode: 1,
            url: 'https://meusanimes.blog/e/test-2-episodio-1/',
          },
        ]),
      );
      m.prisma.anime.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          slug: 'test',
          title: 'Test Anime',
          synopsis: 'syn',
          coverImage: 'cover.jpg',
          bannerImage: null,
          ageRating: 'A14',
          status: 'LANCAMENTO',
          audio: 'LEGENDADO',
          format: 'TV',
          year: 2024,
          season: 'WINTER',
          studios: [],
          themes: [],
          alternativeTitles: [],
          published: true,
        })
        .mockResolvedValueOnce(null);
      m.prisma.anime.create.mockResolvedValue({ id: 'a2' });
      m.prisma.episode.findMany.mockResolvedValue([]);

      const result = await scanner.processScanCatalog('a1', 'test');
      expect(result.missing).toBe(1);
      expect(m.prisma.anime.create).toHaveBeenCalled();
    });

    it('usa sibling existente quando slug-2 já existe', async () => {
      jest.spyOn(scanner, 'scanAnimeResolved' as any).mockResolvedValue(
        meusaScan([
          {
            season: 2,
            episode: 1,
            url: 'https://meusanimes.blog/e/test-2-episodio-1/',
          },
        ]),
      );
      m.prisma.anime.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          slug: 'test',
          title: 'Test',
          synopsis: '',
          coverImage: null,
          bannerImage: null,
          ageRating: 'A14',
          status: 'LANCAMENTO',
          audio: 'LEGENDADO',
          format: 'TV',
          year: 2024,
          season: 'WINTER',
          studios: [],
          themes: [],
          alternativeTitles: [],
          published: true,
        })
        .mockResolvedValueOnce({ id: 'a2-sibling' });
      m.prisma.episode.findMany.mockResolvedValue([{ number: 1 }]);

      const result = await scanner.processScanCatalog('a1', 'test');
      expect(result.found).toBe(1);
      expect(result.missing).toBe(0);
    });

    it('processa sibling com slug terminando em -<n>', async () => {
      jest.spyOn(scanner, 'scanAnimeResolved' as any).mockResolvedValue(
        meusaScan([
          {
            season: 2,
            episode: 1,
            url: 'https://meusanimes.blog/e/test-2-episodio-1/',
          },
        ]),
      );
      m.prisma.anime.findUnique.mockResolvedValue({
        id: 'a1',
        slug: 'test-2',
        title: 'Test',
        synopsis: '',
        coverImage: null,
        bannerImage: null,
        ageRating: 'A14',
        status: 'LANCAMENTO',
        audio: 'LEGENDADO',
        format: 'TV',
        year: 2024,
        season: 'WINTER',
        studios: [],
        themes: [],
        alternativeTitles: [],
        published: true,
      });
      m.prisma.episode.findMany.mockResolvedValue([]);

      const result = await scanner.processScanCatalog('a1', 'test-2');
      expect(result.found).toBe(1);
      expect(result.missing).toBe(1);
    });
  });

  describe('parseCatalog', () => {
    it('ordena por season e episode', async () => {
      const html = `
        <div class="numerando">2 - 1</div>
        <div class="episodiotitle"><a href="https://meusanimes.blog/e/test-s2e1/">Ep</a></div>
        <div class="numerando">1 - 2</div>
        <div class="episodiotitle"><a href="https://meusanimes.blog/e/test-s1e2/">Ep</a></div>
        <div class="numerando">1 - 1</div>
        <div class="episodiotitle"><a href="https://meusanimes.blog/e/test-s1e1/">Ep</a></div>
      `;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(html),
      });
      const entries = await scanner.scanAnime('test');
      expect(entries[0]!.season).toBe(1);
      expect(entries[0]!.episode).toBe(1);
      expect(entries[1]!.season).toBe(1);
      expect(entries[1]!.episode).toBe(2);
      expect(entries[2]!.season).toBe(2);
      expect(entries[2]!.episode).toBe(1);
    });
  });

  describe('animesdigital (fallback de catálogo)', () => {
    /** Card real do animesdigital: href por post-ID + rótulo "Episódio NN". */
    const card = (postId: string, label: string) => `
      <a href="https://animesdigital.org/video/a/${postId}/" class="b_flex">
        <div class="thumb">
          <img src="https://animesdigital.org/wp-content/uploads/x.jpg"
               alt="Assistir ${label}" title="Assistir ${label}">
        </div>
        <div class="dados b_flex">
          <div class="left">
            <div class="title_anime">${label}</div>
            <div class="date">1 dia atrás </div>
          </div>
        </div>
      </a>`;

    beforeEach(() => {
      process.env.ANIMESDIGITAL_ENABLED = 'true';
    });

    afterEach(() => {
      delete process.env.ANIMESDIGITAL_ENABLED;
    });

    it('cai no animesdigital quando o meusanimes vem vazio', async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (String(url).includes('meusanimes.blog')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('<html>vazio</html>'),
          });
        }
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              card('139003', 'Steel Ball Run Episódio 01') +
                card('139004', 'Steel Ball Run Episódio 02'),
            ),
        });
      });

      const scan = await scanner.scanAnimeResolved(
        'jojo-no-kimyou-na-bouken-steel-ball-run',
      );
      expect(scan.sourceId).toBe('animesdigital');
      expect(scan.sourceSlug).toBe('jojo-no-kimyou-na-bouken-steel-ball-run');
      expect(scan.entries).toEqual([
        {
          season: 1,
          episode: 1,
          url: 'https://animesdigital.org/video/a/139003',
        },
        {
          season: 1,
          episode: 2,
          url: 'https://animesdigital.org/video/a/139004',
        },
      ]);
    });

    it('mantém meusanimes como fonte quando ele responde', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(`
          <div class="numerando">1 - 1</div>
          <div class="episodiotitle"><a href="https://meusanimes.blog/e/test-episodio-1/">Ep 1</a></div>
        `),
      });

      const scan = await scanner.scanAnimeResolved('test');
      expect(scan.sourceId).toBe('meusanimes');
      expect(scan.entries[0]!.url).toContain('meusanimes.blog');
    });

    it('ignora animesdigital quando a fonte está desligada', async () => {
      delete process.env.ANIMESDIGITAL_ENABLED;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('<html>vazio</html>'),
      });

      const scan = await scanner.scanAnimeResolved('test');
      expect(scan.sourceId).toBe('');
      expect(scan.entries).toEqual([]);
      // Só o meusanimes foi consultado
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('não vaza o rótulo do card seguinte ao parsear', async () => {
      // O 1º card não tem "Episódio NN": o regex não pode atravessar o <a> seguinte.
      const html = `
        <a href="https://animesdigital.org/video/a/139003/" class="b_flex">
          <div class="date">sem numero</div>
        </a>
        ${card('139004', 'Steel Ball Run Episódio 02')}`;

      const entries = (scanner as any).parseAnimesdigitalCatalog(html);
      expect(entries).toEqual([
        {
          season: 1,
          episode: 2,
          url: 'https://animesdigital.org/video/a/139004',
        },
      ]);
    });

    it('descobre o slug pela busca quando o slug direto não existe', async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (String(url).includes('animesdigital.org/?s=')) {
          return Promise.resolve({
            ok: true,
            text: () =>
              Promise.resolve(
                '<a href="https://animesdigital.org/anime/a/jojo-steel-ball-run-dublado">x</a>' +
                  '<a href="https://animesdigital.org/anime/a/outro-dublado">y</a>' +
                  '<a href="https://animesdigital.org/anime/a/jojo-no-kimyou-na-bouken-steel-ball-run">z</a>',
              ),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const found = await (scanner as any).discoverAnimesdigitalSlug(
        'jojo-no-kimyou-na-bouken-steel-ball-run',
      );
      expect(found).toBe('jojo-no-kimyou-na-bouken-steel-ball-run');
    });

    it('respeita dublado/legendado na descoberta de slug', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            '<a href="https://animesdigital.org/anime/a/jojo-steel-ball-run">lendado</a>' +
              '<a href="https://animesdigital.org/anime/a/jojo-steel-ball-run-dublado">dub</a>',
          ),
      });

      const dub = await (scanner as any).discoverAnimesdigitalSlug(
        'jojo-steel-ball-run-dublado',
      );
      expect(dub).toBe('jojo-steel-ball-run-dublado');
    });

    it('processScanCatalog grava AnimeSource na fonte animesdigital', async () => {
      jest.spyOn(scanner, 'scanAnimeResolved' as any).mockResolvedValue({
        sourceId: 'animesdigital',
        sourceSlug: 'jojo-no-kimyou-na-bouken-steel-ball-run',
        entries: [
          {
            season: 1,
            episode: 1,
            url: 'https://animesdigital.org/video/a/139003',
          },
        ],
      });
      m.prisma.animeSource.findUnique.mockResolvedValue(null);
      m.prisma.anime.findUnique.mockResolvedValue({
        id: 'a1',
        slug: 'jojo-no-kimyou-na-bouken-steel-ball-run',
        title: 'JoJo no Kimyou na Bouken: Steel Ball Run',
        synopsis: '',
        coverImage: null,
        bannerImage: null,
        ageRating: 'A14',
        status: 'LANCAMENTO',
        audio: 'LEGENDADO',
        format: 'TV',
        year: 2026,
        season: 'SUMMER',
        studios: [],
        themes: [],
        alternativeTitles: [],
        published: true,
      });
      m.prisma.episode.findMany.mockResolvedValue([]);

      const result = await scanner.processScanCatalog(
        'a1',
        'jojo-no-kimyou-na-bouken-steel-ball-run',
      );
      expect(result).toEqual({ found: 1, missing: 1 });
      expect(m.prisma.animeSource.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            animeId_sourceId: { animeId: 'a1', sourceId: 'animesdigital' },
          },
          create: expect.objectContaining({
            sourceId: 'animesdigital',
            externalUrl:
              'https://animesdigital.org/anime/a/jojo-no-kimyou-na-bouken-steel-ball-run',
            externalKey: 'jojo-no-kimyou-na-bouken-steel-ball-run',
          }),
        }),
      );
      expect(m.jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            episodeUrl: 'https://animesdigital.org/video/a/139003',
          }),
        }),
      );
    });
  });
});
