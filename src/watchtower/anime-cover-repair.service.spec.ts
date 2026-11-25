import { AnimeCoverRepair } from './anime-cover-repair.service';

function anime(overrides: Record<string, unknown> = {}) {
  return {
    id: 'anime-id',
    slug: 'frieren-beyond-journeys-end',
    coverImage: null,
    title: "Frieren: Beyond Journey's End",
    japaneseTitle: 'Sousou no Frieren',
    alternativeTitles: ['Frieren'],
    year: 2023,
    anilistId: null,
    malId: null,
    ...overrides,
  };
}

function makeService(batch = [anime()]) {
  const leaseValue = '9999999999999|test-owner';
  const prisma = {
    siteSetting: {
      findUnique: jest.fn().mockResolvedValue({ value: null }),
      upsert: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    anime: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: jest.fn(async (...args: [TemplateStringsArray, ...unknown[]]) =>
      args[0].join('').includes('"SiteSetting"')
        ? [{ value: leaseValue }]
        : batch,
    ),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const anilist = {
    fetchMedia: jest.fn(),
    searchMediaCandidates: jest.fn().mockResolvedValue([]),
  };
  return {
    prisma,
    anilist,
    service: new AnimeCoverRepair(prisma as any, anilist as any),
  };
}

function expectCursorAdvance(
  prisma: ReturnType<typeof makeService>['prisma'],
  id: string,
) {
  expect(
    prisma.$queryRaw.mock.calls.some(
      ([strings, ...values]) =>
        strings.join('').includes('INSERT INTO "SiteSetting"') &&
        values.includes(id),
    ),
  ).toBe(true);
}

function expectCursorNotAdvanced(
  prisma: ReturnType<typeof makeService>['prisma'],
  id: string,
) {
  expect(
    prisma.$queryRaw.mock.calls.some(
      ([strings, ...values]) =>
        strings.join('').includes('INSERT INTO "SiteSetting"') &&
        values.includes(id),
    ),
  ).toBe(false);
}

describe('AnimeCoverRepair', () => {
  const originalMalClientId = process.env.MAL_CLIENT_ID;

  beforeEach(() => {
    delete process.env.MAL_CLIENT_ID;
    jest.restoreAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    if (originalMalClientId === undefined) delete process.env.MAL_CLIENT_ID;
    else process.env.MAL_CLIENT_ID = originalMalClientId;
  });

  it('recupera pelo AniList ID e grava somente se a capa segue vazia', async () => {
    const { service, prisma, anilist } = makeService([
      anime({ anilistId: 123 }),
    ]);
    anilist.fetchMedia.mockResolvedValue({
      coverImage: { extraLarge: 'https://s4.anilist.co/cover.jpg' },
    });

    await expect(service.sweep()).resolves.toBe(1);

    expect(prisma.anime.updateMany).toHaveBeenCalledWith({
      where: { id: 'anime-id', coverImage: null },
      data: { coverImage: 'https://s4.anilist.co/cover.jpg' },
    });
    expectCursorAdvance(prisma, 'anime-id');
  });

  it('recupera pelo MAL ID usando a API oficial quando disponível', async () => {
    process.env.MAL_CLIENT_ID = 'test-client';
    const { service, prisma, anilist } = makeService([anime({ malId: 52991 })]);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 52991,
          title: 'Sousou no Frieren',
          main_picture: { large: 'https://cdn.myanimelist.net/frieren.jpg' },
        }),
        { status: 200 },
      ),
    );

    await expect(service.sweep()).resolves.toBe(1);

    expect(anilist.fetchMedia).not.toHaveBeenCalled();
    expect(prisma.anime.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { coverImage: 'https://cdn.myanimelist.net/frieren.jpg' },
      }),
    );
  });

  it('recupera capa do MAL por título exato e ano', async () => {
    const { service, prisma, anilist } = makeService();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              mal_id: 52991,
              title: 'Sousou no Frieren',
              title_english: "Frieren: Beyond Journey's End",
              year: 2023,
              images: {
                webp: {
                  large_image_url: 'https://cdn.myanimelist.net/frieren.webp',
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(service.sweep()).resolves.toBe(1);

    expect(anilist.searchMediaCandidates).not.toHaveBeenCalled();
    expect(prisma.anime.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { coverImage: 'https://cdn.myanimelist.net/frieren.webp' },
      }),
    );
  });

  it('não associa título ambíguo entre dois IDs do mesmo ano', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              mal_id: 1,
              title: "Frieren: Beyond Journey's End",
              year: 2023,
              images: {
                jpg: {
                  large_image_url: 'https://cdn.myanimelist.net/wrong.jpg',
                },
              },
            },
            {
              mal_id: 2,
              title: "Frieren: Beyond Journey's End",
              year: 2023,
              images: {
                jpg: {
                  large_image_url: 'https://cdn.myanimelist.net/other.jpg',
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(service.sweep()).resolves.toBe(0);

    expect(prisma.anime.updateMany).not.toHaveBeenCalled();
    expectCursorAdvance(prisma, 'anime-id');
  });

  it('rejeita resultado com título igual de outro ano', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              mal_id: 1,
              title: "Frieren: Beyond Journey's End",
              year: 2012,
              images: {
                jpg: {
                  large_image_url: 'https://cdn.myanimelist.net/wrong.jpg',
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(service.sweep()).resolves.toBe(0);

    expect(prisma.anime.updateMany).not.toHaveBeenCalled();
  });

  it('usa AniList quando MAL não encontra uma correspondência segura', async () => {
    const { service, prisma, anilist } = makeService();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
    anilist.searchMediaCandidates.mockResolvedValue([
      {
        id: 123,
        title: {
          romaji: 'Sousou no Frieren',
          english: "Frieren: Beyond Journey's End",
          native: null,
        },
        startDate: { year: 2023 },
        coverImage: { large: 'https://s4.anilist.co/frieren.jpg' },
      },
    ]);

    await expect(service.sweep()).resolves.toBe(1);

    expect(prisma.anime.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { coverImage: 'https://s4.anilist.co/frieren.jpg' },
      }),
    );
  });

  it('compara títulos japoneses preservando os caracteres Unicode', async () => {
    const { service, prisma } = makeService([
      anime({
        slug: 'kimi-no-na-wa',
        title: 'Kimi no Na wa',
        japaneseTitle: '君の名は。',
        alternativeTitles: [],
        year: 2016,
      }),
    ]);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              mal_id: 32281,
              title: '君の名は。',
              year: 2016,
              images: {
                jpg: {
                  large_image_url:
                    'https://cdn.myanimelist.net/kimi-no-na-wa.jpg',
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(service.sweep()).resolves.toBe(1);

    expect(prisma.anime.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { coverImage: 'https://cdn.myanimelist.net/kimi-no-na-wa.jpg' },
      }),
    );
  });

  it('não escolhe entre múltiplos resultados AniList com o mesmo título e ano', async () => {
    const { service, prisma, anilist } = makeService();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
    anilist.searchMediaCandidates.mockResolvedValue([
      {
        id: 123,
        title: { english: "Frieren: Beyond Journey's End" },
        startDate: { year: 2023 },
        coverImage: { large: 'https://s4.anilist.co/first.jpg' },
      },
      {
        id: 456,
        title: { romaji: "Frieren: Beyond Journey's End" },
        startDate: { year: 2023 },
        coverImage: { large: 'https://s4.anilist.co/second.jpg' },
      },
    ]);

    await expect(service.sweep()).resolves.toBe(0);

    expect(prisma.anime.updateMany).not.toHaveBeenCalled();
  });

  it('continua com Jikan se a API oficial do MAL falhar', async () => {
    process.env.MAL_CLIENT_ID = 'test-client';
    const { service, prisma } = makeService();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                mal_id: 52991,
                title_english: "Frieren: Beyond Journey's End",
                year: 2023,
                images: {
                  jpg: {
                    large_image_url: 'https://cdn.myanimelist.net/frieren.jpg',
                  },
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    await expect(service.sweep()).resolves.toBe(1);

    expect(prisma.anime.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { coverImage: 'https://cdn.myanimelist.net/frieren.jpg' },
      }),
    );
  });

  it('avança o cursor quando as duas fontes estão indisponíveis', async () => {
    const { service, prisma, anilist } = makeService();
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('rede indisponível'));
    anilist.searchMediaCandidates.mockRejectedValue(
      new Error('AniList indisponível'),
    );

    await expect(service.sweep()).resolves.toBe(0);

    expect(prisma.anime.updateMany).not.toHaveBeenCalled();
    expectCursorAdvance(prisma, 'anime-id');
  });

  it('reinicia do início depois de chegar ao fim do cursor', async () => {
    const { service, prisma } = makeService();
    prisma.siteSetting.findUnique.mockResolvedValue({ value: 'z-last-id' });
    const batches: ReturnType<typeof anime>[][] = [[], [anime()]];
    prisma.$queryRaw
      .mockImplementationOnce(async () => [
        { value: '9999999999999|test-owner' },
      ])
      .mockImplementationOnce(async () => batches.shift() ?? [])
      .mockImplementationOnce(async () => batches.shift() ?? []);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );

    await service.sweep();

    const animeQueries = prisma.$queryRaw.mock.calls.filter(([strings]) =>
      strings.join('').includes('FROM "Anime"'),
    );
    expect(animeQueries[0]?.[1]).toBe('z-last-id');
    expect(animeQueries[1]?.[1]).toBe('');
  });

  it('não inicia uma segunda instância enquanto outra mantém o lease', async () => {
    const { service, prisma, anilist } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.sweep()).resolves.toBe(0);

    expect(prisma.siteSetting.findUnique).not.toHaveBeenCalled();
    expect(anilist.fetchMedia).not.toHaveBeenCalled();
  });

  it('não grava nem avança o cursor se o lease for perdido durante a consulta', async () => {
    const { service, prisma, anilist } = makeService([
      anime({ anilistId: 123 }),
    ]);
    prisma.$queryRaw
      .mockImplementationOnce(async () => [
        { value: '9999999999999|test-owner' },
      ])
      .mockImplementationOnce(async () => [anime({ anilistId: 123 })])
      .mockImplementationOnce(async () => [
        { value: '9999999999999|test-owner' },
      ])
      .mockImplementationOnce(async () => []);
    anilist.fetchMedia.mockResolvedValue({
      coverImage: { large: 'https://s4.anilist.co/cover.jpg' },
    });

    await expect(service.sweep()).rejects.toThrow(
      'Lease de reparo de capas expirou.',
    );

    expect(prisma.anime.updateMany).not.toHaveBeenCalled();
    expectCursorNotAdvanced(prisma, 'anime-id');
  });

  it('renova o lease enquanto aguarda uma consulta externa longa', async () => {
    jest.useFakeTimers();
    const { service, prisma } = makeService([anime({ anilistId: 123 })]);
    let finishLookup!: (cover: string | null) => void;
    jest
      .spyOn(service as any, 'resolveCover')
      .mockImplementation(
        () => new Promise((resolve) => (finishLookup = resolve)),
      );

    try {
      const pending = service.sweep();
      await jest.advanceTimersByTimeAsync(7 * 60_000);

      expect(
        prisma.$queryRaw.mock.calls.filter(([strings]) =>
          strings.join('').includes('UPDATE "SiteSetting"'),
        ),
      ).toHaveLength(2);

      finishLookup('https://s4.anilist.co/cover.jpg');
      await expect(pending).resolves.toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('aborta o sweep se a renovação do lease ficar presa', async () => {
    jest.useFakeTimers();
    const { service, prisma } = makeService([anime({ anilistId: 123 })]);
    let finishLookup!: (cover: string | null) => void;
    jest
      .spyOn(service as any, 'resolveCover')
      .mockImplementation(
        () => new Promise((resolve) => (finishLookup = resolve)),
      );
    let calls = 0;
    prisma.$queryRaw.mockImplementation(async (...args) => {
      calls++;
      if (calls === 4) return new Promise(() => {});
      return args[0].join('').includes('"SiteSetting"')
        ? [{ value: '9999999999999|test-owner' }]
        : [anime({ anilistId: 123 })];
    });

    try {
      const pending = service.sweep();
      const rejected = expect(pending).rejects.toThrow(
        'Lease de reparo de capas expirou.',
      );
      await jest.advanceTimersByTimeAsync(7 * 60_000);
      finishLookup('https://s4.anilist.co/cover.jpg');
      await jest.advanceTimersByTimeAsync(10_000);

      await rejected;
      expect(prisma.anime.updateMany).not.toHaveBeenCalled();
      expectCursorNotAdvanced(prisma, 'anime-id');
      expect(prisma.$executeRaw).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('limita espera de liberação presa para não travar sweeps locais', async () => {
    jest.useFakeTimers();
    const { service, prisma } = makeService([]);
    prisma.$executeRaw.mockImplementation(() => new Promise(() => {}));

    try {
      const pending = service.sweep();
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retenta uma gravação que falha no próximo ciclo', async () => {
    const { service, prisma, anilist } = makeService([
      anime({ anilistId: 123 }),
    ]);
    anilist.fetchMedia.mockResolvedValue({
      coverImage: { large: 'https://s4.anilist.co/cover.jpg' },
    });
    prisma.anime.updateMany.mockRejectedValueOnce(new Error('DB indisponível'));

    await expect(service.sweep()).resolves.toBe(0);

    expectCursorAdvance(prisma, 'anime-id');
  });

  it('repara um valor de capa que contém apenas whitespace', async () => {
    const blank = ' \t\n ';
    const { service, prisma, anilist } = makeService([
      anime({ coverImage: blank, anilistId: 123 }),
    ]);
    anilist.fetchMedia.mockResolvedValue({
      coverImage: { large: 'https://s4.anilist.co/cover.jpg' },
    });

    await service.sweep();

    expect(prisma.anime.updateMany).toHaveBeenCalledWith({
      where: { id: 'anime-id', coverImage: blank },
      data: { coverImage: 'https://s4.anilist.co/cover.jpg' },
    });
  });
});
