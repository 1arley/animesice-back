import { StreamingService } from './streaming.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Readable } from 'stream';
import * as mediaProbe from '@/common/media-probe';
import * as trustedMediaHosts from '@/common/trusted-media-hosts';

function makeMocks() {
  const jobRows = new Map<string, any>();
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.OR)
      return where.OR.some((item: any) =>
        matches(row, { ...where, OR: undefined, ...item }),
      );
    return Object.entries(where).every(([key, value]: [string, any]) => {
      if (key === 'OR' || value === undefined) return true;
      if (value?.in) return value.in.includes(row[key]);
      if (value?.lt) return row[key] < value.lt;
      return row[key] === value;
    });
  };

  const db = {
    anime: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    episode: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    episodeSource: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    streamingToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
    streamExtractionJob: {
      create: jest.fn(async ({ data }: any) => {
        if (
          [...jobRows.values()].some(
            (row) => data.activeKey && row.activeKey === data.activeKey,
          )
        ) {
          const error: any = new Error('unique');
          error.code = 'P2002';
          throw error;
        }
        const row = {
          id: data.id ?? crypto.randomUUID(),
          status: 'pending',
          videoUrl: null,
          playerEmbed: null,
          error: null,
          lockedBy: null,
          lockedUntil: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        jobRows.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: any) => jobRows.get(where.id) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          [...jobRows.values()].find((row) => matches(row, where)) ?? null,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const found = [...jobRows.values()].filter((row) =>
          matches(row, where),
        );
        found.forEach((row) =>
          Object.assign(row, data, { updatedAt: new Date() }),
        );
        return { count: found.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const found = [...jobRows.values()].filter((row) =>
          matches(row, where),
        );
        found.forEach((row) => jobRows.delete(row.id));
        return { count: found.length };
      }),
    },
  };
  const prisma = {
    ...db,
    $transaction: jest.fn(async (work: (tx: typeof db) => unknown) => work(db)),
  };
  const embedService = { proxyMedia: jest.fn() };
  const scrapeService = {
    scrapeEpisodeVideo: jest.fn().mockResolvedValue({ videos: [] }),
    isSourceDisabled: jest.fn(
      async (_sourceId?: string, _pageUrl?: string) => false,
    ),
    supportsSource: jest.fn((_sourceId: string, _pageUrl: string) => true),
    detectSourceId: jest.fn(() => null),
    scrapeEpisodeFromRankedSources: jest.fn().mockResolvedValue(null),
  };
  const svc = new StreamingService(
    prisma as any,
    embedService as any,
    scrapeService as any,
  );
  return { prisma, jobRows, embedService, scrapeService, svc };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('StreamingService.purgeExpiredTokens', () => {
  it('remove tokens expirados e loga quando count > 0', async () => {
    const { prisma, svc } = makeMocks();
    prisma.streamingToken.deleteMany.mockResolvedValue({ count: 5 });
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await svc.purgeExpiredTokens();
    expect(prisma.streamingToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('5 tokens expirados'),
    );
    logSpy.mockRestore();
  });

  it('não loga quando count = 0', async () => {
    const { prisma, svc } = makeMocks();
    prisma.streamingToken.deleteMany.mockResolvedValue({ count: 0 });
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await svc.purgeExpiredTokens();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe('StreamingService.cleanupMemoryCaches', () => {
  let purgeSpy: jest.SpyInstance;

  beforeEach(() => {
    purgeSpy = jest
      .spyOn(mediaProbe, 'purgeExpiredLivenessCache')
      .mockReturnValue(0);
  });

  afterEach(() => {
    purgeSpy.mockRestore();
  });

  it('remove entradas expiradas do scrapeCache e mantém as frescas', () => {
    const { svc } = makeMocks();
    const cache = (svc as any).scrapeCache as Map<string, any>;
    cache.set('expired', {
      result: { videoUrl: null, playerEmbed: null },
      at: 0,
    });
    cache.set('fresh', {
      result: { videoUrl: 'http://x', playerEmbed: null },
      at: Date.now(),
    });
    svc.cleanupMemoryCaches();
    expect(cache.has('expired')).toBe(false);
    expect(cache.has('fresh')).toBe(true);
  });

  it('chama purgeExpiredLivenessCache e limpa streamExtractionJob expirados', () => {
    const { prisma, svc } = makeMocks();
    svc.cleanupMemoryCaches();
    expect(purgeSpy).toHaveBeenCalled();
    expect(prisma.streamExtractionJob.deleteMany).toHaveBeenCalled();
  });

  it('evict scrapeCache quando excede MAX_SCRAPE_CACHE_ENTRIES', () => {
    const { svc } = makeMocks();
    const cache = (svc as any).scrapeCache as Map<string, any>;
    const base = Date.now();
    for (let i = 0; i <= 300; i++) {
      cache.set(`k${i}`, {
        result: { videoUrl: null, playerEmbed: null },
        at: base + i,
      });
    }
    svc.cleanupMemoryCaches();
    expect(cache.size).toBe(300);
  });

  it('evict scrapeInflight quando excede MAX_INFLIGHT_ENTRIES', () => {
    const { svc } = makeMocks();
    const inflight = (svc as any).scrapeInflight as Map<string, any>;
    for (let i = 0; i < 210; i++) {
      inflight.set(`k${i}`, Promise.resolve({ videoUrl: null }));
    }
    svc.cleanupMemoryCaches();
    expect(inflight.size).toBe(200);
  });
});

describe('StreamingService.generateToken', () => {
  it('lança NotFoundException quando anime não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue(null);
    await expect(
      svc.generateToken('1', 'nao-existe', '127.0.0.1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('lança NotFoundException quando episódio não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(svc.generateToken('1', 'anime', '127.0.0.1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lança NotFoundException quando episódio não tem videoUrl', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
    });
    await expect(svc.generateToken('1', 'anime', '127.0.0.1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('gera token e URL assinada com sucesso', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://cdn.example.com/video.mp4',
    });

    const result = await svc.generateToken('1', 'anime', '10.0.0.1', 3600);
    expect(result.token).toBeDefined();
    expect(result.ip).toBe('10.0.0.1');
    expect(result.url).toContain('token=');
    expect(result.url).toContain('ip=10.0.0.1');
    expect(prisma.streamingToken.create).toHaveBeenCalled();
  });

  it('trata episodeSlug não-numérico como NaN na busca', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(
      svc.generateToken('abc', 'anime', '127.0.0.1'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('StreamingService.validateToken', () => {
  it('lança ForbiddenException quando expires já passou', async () => {
    const { svc } = makeMocks();
    const past = Math.floor(Date.now() / 1000) - 60;
    await expect(svc.validateToken('tok', past, '127.0.0.1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lança ForbiddenException quando token não existe no banco', async () => {
    const { prisma, svc } = makeMocks();
    prisma.streamingToken.findUnique.mockResolvedValue(null);
    const future = Math.floor(Date.now() / 1000) + 3600;
    await expect(svc.validateToken('tok', future, '127.0.0.1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lança ForbiddenException quando IP não corresponde', async () => {
    const { prisma, svc } = makeMocks();
    const future = Math.floor(Date.now() / 1000) + 3600;
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '10.0.0.1',
      expiresAt: new Date(Date.now() + 3600_000),
      episodeId: 'ep-1',
    });
    await expect(svc.validateToken('tok', future, '127.0.0.1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lança ForbiddenException quando expiresAt do banco já venceu', async () => {
    const { prisma, svc } = makeMocks();
    const future = Math.floor(Date.now() / 1000) + 3600;
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt: new Date(Date.now() - 1000),
      episodeId: 'ep-1',
    });
    await expect(svc.validateToken('tok', future, '127.0.0.1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lança NotFoundException quando episódio ou videoUrl não existe', async () => {
    const { prisma, svc } = makeMocks();
    const future = Math.floor(Date.now() / 1000) + 3600;
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt: new Date(Date.now() + 3600_000),
      episodeId: 'ep-1',
    });
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(svc.validateToken('tok', future, '127.0.0.1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('retorna dados do episódio quando o token é válido', async () => {
    const { prisma, svc } = makeMocks();
    const future = Math.floor(Date.now() / 1000) + 3600;
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt: new Date(Date.now() + 3600_000),
      episodeId: 'ep-1',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 3,
      season: 1,
      embedUrl: 'https://meusanimes.blog/e/meu-anime-3/',
      videoUrl: 'https://cdn.example.com/v.mp4',
      anime: { slug: 'meu-anime', audio: 'LEGENDADO' },
    });

    const result = await svc.validateToken('tok', future, '127.0.0.1');
    expect(result.videoUrl).toBe('https://cdn.example.com/v.mp4');
    expect(result.episodeId).toBe('ep-1');
    expect(result.animeSlug).toBe('meu-anime');
    expect(result.episodeNumber).toBe(3);
    expect(result.season).toBe(1);
  });
});

describe('StreamingService.proxyVideo', () => {
  beforeEach(() =>
    jest.spyOn(mediaProbe, 'probeMediaUrlDead').mockResolvedValue(false),
  );
  afterEach(() => jest.restoreAllMocks());

  it('retorna stream com sucesso (200)', async () => {
    const { prisma, embedService, svc } = makeMocks();
    const expiresAt = new Date(Date.now() + 9999000);
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt,
      episodeId: 'ep-1',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      season: 1,
      videoUrl: 'https://rr1.googlevideo.com/videoplayback?expire=999999',
      anime: { slug: 'anime' },
    });
    embedService.proxyMedia.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      body: new Readable({ read() {} }),
    });

    const future = Math.floor(Date.now() / 1000) + 9999;
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(200);
    expect(result.body).toBeDefined();
  });

  it('repassa range header quando fornecido', async () => {
    const { prisma, embedService, svc } = makeMocks();
    const expiresAt = new Date(Date.now() + 9999000);
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt,
      episodeId: 'ep-1',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      season: 1,
      videoUrl: 'https://rr1.googlevideo.com/videoplayback?expire=999999',
      anime: { slug: 'anime' },
    });
    embedService.proxyMedia.mockResolvedValue({
      status: 206,
      headers: { 'content-range': 'bytes 0-99/1000' },
      body: null,
    });

    const future = Math.floor(Date.now() / 1000) + 9999;
    await svc.proxyVideo('tok', future, '127.0.0.1', 'bytes=0-99');
    expect(embedService.proxyMedia).toHaveBeenCalledWith(
      expect.any(String),
      { range: 'bytes=0-99' },
      expect.any(String),
    );
  });

  it.each([401, 403, 404, 410, 500, 502, 503])(
    'em %i reextrai via doSingleScrape e refaz proxy com sucesso',
    async (status) => {
      const { prisma, embedService, scrapeService, svc } = makeMocks();
      const expiresAt = new Date(Date.now() + 9999000);
      prisma.streamingToken.findUnique.mockResolvedValue({
        token: 'tok',
        ip: '127.0.0.1',
        expiresAt,
        episodeId: 'ep-1',
      });
      prisma.episode.findUnique.mockResolvedValue({
        id: 'ep-1',
        number: 1,
        season: 1,
        embedUrl: 'https://meusanimes.blog/e/anime-1/',
        videoUrl: 'https://rr1.googlevideo.com/videoplayback?expire=100',
        anime: { slug: 'anime', audio: 'LEGENDADO' },
      });
      embedService.proxyMedia
        .mockResolvedValueOnce({
          status,
          headers: {},
          body: null,
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'video/mp4' },
          body: null,
        });
      scrapeService.scrapeEpisodeVideo.mockResolvedValue({
        videos: ['https://rr2.googlevideo.com/videoplayback?expire=999999'],
      });

      const future = Math.floor(Date.now() / 1000) + 9999;
      const result = await svc.proxyVideo('tok', future, '127.0.0.1');
      expect(result.status).toBe(200);
      expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledWith(
        'https://meusanimes.blog/e/anime-1/',
        undefined,
        false,
        true,
        'LEGENDADO',
      );
      expect(prisma.episode.update).toHaveBeenCalledWith({
        where: { id: 'ep-1' },
        data: {
          videoUrl: 'https://rr2.googlevideo.com/videoplayback?expire=999999',
        },
      });
    },
  );

  it('em 403 tenta scrapeEpisodeFromRankedSources como fallback se a URL persistida falha', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const expiresAt = new Date(Date.now() + 9999000);
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt,
      episodeId: 'ep-1',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      season: 1,
      videoUrl: 'https://rr1.googlevideo.com/videoplayback?expire=100',
      anime: { slug: 'anime' },
    });
    embedService.proxyMedia
      .mockResolvedValueOnce({ status: 403, headers: {}, body: null })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'video/mp4' },
        body: null,
      });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue({
      videoUrl: 'https://rr3.googlevideo.com/videoplayback?expire=999999',
      sourceId: 'meusanimes',
      pageUrl: 'https://meusanimes.blog/e/anime-1/',
    });

    const future = Math.floor(Date.now() / 1000) + 9999;
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(200);
    expect(scrapeService.scrapeEpisodeFromRankedSources).toHaveBeenCalledWith(
      'anime',
      1,
      1,
      undefined,
      expect.any(Function),
    );
  });

  it('em 403 lança ForbiddenException quando reextract e fallback ranqueado falham', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const expiresAt = new Date(Date.now() + 9999000);
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt,
      episodeId: 'ep-1',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      season: 1,
      videoUrl: 'https://rr1.googlevideo.com/videoplayback?expire=100',
      anime: { slug: 'anime' },
    });
    embedService.proxyMedia.mockResolvedValue({
      status: 403,
      headers: {},
      body: null,
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue(null);

    const future = Math.floor(Date.now() / 1000) + 9999;
    await expect(svc.proxyVideo('tok', future, '127.0.0.1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('StreamingService.getSource', () => {
  let probeSpy: jest.SpyInstance;

  beforeEach(() => {
    probeSpy = jest
      .spyOn(mediaProbe, 'probeMediaUrlDead')
      .mockResolvedValue(false);
  });

  afterEach(() => {
    probeSpy.mockRestore();
  });

  it('descarta vidcache morta quando não há outra fonte ativa', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    const dead = 'https://vidcache.net:8161/token/video.mp4';
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep1',
      number: 1,
      videoUrl: dead,
      embedUrl: 'https://meusanimes.blog/e/anime/',
    });
    probeSpy.mockImplementation((url: string) => Promise.resolve(url === dead));
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({ videos: [dead] });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue(null);
    await expect(
      svc.getSource('anime', 1, 'https://api.test', 1, true),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('serve YouTube embed como iframe quando extração .mp4 falha', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'voce-so-precisa-matar',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/all-you-need-is-kill-episodio-1/',
      thumbnailUrl: 'thumb.jpg',
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: ['https://www.youtube-nocookie.com/embed/0YpXN40vIxM'],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue(null);

    const result = await svc.getSource(
      'voce-so-precisa-matar',
      1,
      'https://api.animesice.app',
    );

    expect(result.src).toBe(
      'https://www.youtube-nocookie.com/embed/0YpXN40vIxM',
    );
    expect(result.rawVideoUrl).toBe(
      'https://www.youtube-nocookie.com/embed/0YpXN40vIxM',
    );
    expect(result.embedUrl).toBe(
      'https://www.youtube-nocookie.com/embed/0YpXN40vIxM',
    );
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('serve token Blogger pelo proxy de iframe quando extração .mp4 falha', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'zenonzard-the-animation',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl:
        'https://meusanimes.blog/e/zenonzard-the-animation-1-episodio-1/',
      thumbnailUrl: 'thumb.jpg',
    });
    const blogger = 'https://www.blogger.com/video.g?token=valid-token';
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [blogger],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue(null);

    const result = await svc.getSource(
      'zenonzard-the-animation',
      1,
      'https://api.animesice.app',
    );

    expect(result.rawVideoUrl).toBe(blogger);
    expect(result.src).toBe(
      `https://api.animesice.app/api/embed/proxy?url=${encodeURIComponent(blogger)}`,
    );
    expect(result.embedUrl).toBe(result.src);
  });

  it('preserva Blogger quando fallback ranqueado rejeita (regressão #42)', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'zenonzard-the-animation',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl:
        'https://meusanimes.blog/e/zenonzard-the-animation-1-episodio-1/',
      thumbnailUrl: 'thumb.jpg',
    });
    const blogger = 'https://www.blogger.com/video.g?token=valid-token';
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [blogger],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockRejectedValue(
      new Error('meusanimes indisponível'),
    );

    const result = await svc.getSource(
      'zenonzard-the-animation',
      1,
      'https://api.animesice.app',
    );

    expect(result.rawVideoUrl).toBe(blogger);
    expect(result.src).toBe(
      `https://api.animesice.app/api/embed/proxy?url=${encodeURIComponent(blogger)}`,
    );
    expect(scrapeService.scrapeEpisodeFromRankedSources).toHaveBeenCalledWith(
      'zenonzard-the-animation',
      1,
      1,
      undefined,
      expect.any(Function),
    );
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('preserva YouTube embed quando fallback ranqueado rejeita', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'voce-so-precisa-matar',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/all-you-need-is-kill-episodio-1/',
      thumbnailUrl: 'thumb.jpg',
    });
    const yt = 'https://www.youtube-nocookie.com/embed/0YpXN40vIxM';
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [yt],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockRejectedValue(
      new Error('timeout'),
    );

    const result = await svc.getSource(
      'voce-so-precisa-matar',
      1,
      'https://api.animesice.app',
    );

    expect(result.src).toBe(yt);
    expect(result.rawVideoUrl).toBe(yt);
  });

  it('prioriza mp4 do fallback sobre Blogger da fonte original', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'qualquer-anime',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://example.com/ep-1',
      thumbnailUrl: 'thumb.jpg',
    });
    const blogger = 'https://www.blogger.com/video.g?token=x';
    const mp4 = 'https://cdn.example.com/video.mp4';
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [blogger],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue({
      videoUrl: mp4,
      sourceId: 'meusanimes',
      pageUrl: 'https://meusanimes.blog/e/qualquer-anime-1/',
    });

    const result = await svc.getSource(
      'qualquer-anime',
      1,
      'https://api.animesice.app',
    );

    expect(result.rawVideoUrl).toBe(mp4);
    expect(result.src).not.toContain('/embed/proxy');
  });

  it('mantém 404 quando ambas as fontes falham (rejeição + nada)', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'qualquer-anime',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://example.com/ep-1',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockRejectedValue(
      new Error('upstream indisponível'),
    );

    await expect(
      svc.getSource('qualquer-anime', 1, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);
  });

  it('mantém 404 quando nenhuma fonte resolve', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'qualquer-anime',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue(null);

    await expect(
      svc.getSource('qualquer-anime', 1, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);
  });

  it('usa videoUrl direto quando já existe (não re-extrai)', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'demon-slayer-kimetsu-no-yaiba',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://pub-c7f4.r2.dev/Leg.mp4',
      embedUrl: 'https://meusanimes.blog/e/x/',
      thumbnailUrl: null,
    });

    const result = await svc.getSource(
      'demon-slayer-kimetsu-no-yaiba',
      1,
      'https://api.animesice.app',
    );

    expect(result.rawVideoUrl).toBe('https://pub-c7f4.r2.dev/Leg.mp4');
    expect(result.src).toContain('/api/embed/media');
    expect(scrapeService.scrapeEpisodeVideo).not.toHaveBeenCalled();
  });

  it('reextrai antes de responder quando a videoUrl salva está morta', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    const stale = 'https://rr1.googlevideo.com/videoplayback?expire=1700000000';
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'anime-dead',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: stale,
      embedUrl: 'https://meusanimes.blog/e/anime-dead-1/',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://rr2.googlevideo.com/videoplayback?expire=9999999999'],
      playerTokens: [],
    });
    prisma.episode.update.mockResolvedValue({});
    probeSpy.mockResolvedValueOnce(true);

    const result = await svc.getSource(
      'anime-dead',
      1,
      'https://api.animesice.app',
    );

    expect(result.rawVideoUrl).toBe(
      'https://rr2.googlevideo.com/videoplayback?expire=9999999999',
    );
    expect(result.reextracted).toBe(true);

    expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledWith(
      'https://meusanimes.blog/e/anime-dead-1/',
      undefined,
      false,
      true,
      undefined,
    );
    expect(prisma.episode.update).toHaveBeenCalledWith({
      where: { id: 'ep-1' },
      data: {
        videoUrl: 'https://rr2.googlevideo.com/videoplayback?expire=9999999999',
      },
    });
  });

  it('refresh forçado ignora videoUrl salvo e exige extração nova', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'anime-refresh',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://rr1.googlevideo.com/videoplayback?expire=9999999999',
      embedUrl: 'https://meusanimes.blog/e/anime-refresh-1/',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://rr2.googlevideo.com/videoplayback?expire=9999999999'],
      playerTokens: [],
    });
    prisma.episode.update.mockResolvedValue({});
    probeSpy.mockResolvedValueOnce(true);

    const result = await svc.getSource(
      'anime-refresh',
      1,
      'https://api.animesice.app',
      1,
      true,
    );

    expect(result.reextracted).toBe(true);
    expect(result.rawVideoUrl).toContain('rr2.googlevideo.com');
    expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledWith(
      'https://meusanimes.blog/e/anime-refresh-1/',
      undefined,
      false,
      true,
      undefined,
    );
  });

  it('refresh solicitado mantém a URL atual quando o probe real confirma vida', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    const current =
      'https://rr1.googlevideo.com/videoplayback?expire=9999999999';
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'anime-alive',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: current,
      embedUrl: 'https://meusanimes.blog/e/anime-alive-1/',
      thumbnailUrl: null,
    });
    probeSpy.mockResolvedValueOnce(false);

    const result = await svc.getSource(
      'anime-alive',
      1,
      'https://api.animesice.app',
      1,
      true,
    );

    expect(result.rawVideoUrl).toBe(current);
    expect(result.reextracted).toBe(false);
    expect(probeSpy).toHaveBeenCalledWith(current, true);
    expect(scrapeService.scrapeEpisodeVideo).not.toHaveBeenCalled();
  });

  it('lança NotFoundException quando o anime não existe ou foi despublicado manualmente', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue(null);
    await expect(
      svc.getSource('nao-existe', 1, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);

    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'manual-unpub',
      published: false,
      catalogUnpublished: false,
    });
    await expect(
      svc.getSource('manual-unpub', 1, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);
  });

  it('permite auto-recuperação de anime com catalogUnpublished=true quando videoUrl está vivo', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'auto-unpub',
      published: false,
      catalogUnpublished: true,
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://cdn.example.com/live.mp4',
      embedUrl: null,
      thumbnailUrl: null,
    });
    probeSpy.mockResolvedValueOnce(false);

    const result = await svc.getSource(
      'auto-unpub',
      1,
      'https://api.animesice.app',
      1,
      false,
      true,
    );
    expect(result.rawVideoUrl).toBe('https://cdn.example.com/live.mp4');
    expect(prisma.anime.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodes: { some: { id: 'ep-1' } },
          published: false,
        },
        data: expect.objectContaining({
          published: true,
          catalogUnpublished: false,
        }),
      }),
    );
  });

  it('lança NotFoundException quando o episódio não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime-sem-ep',
    });
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(
      svc.getSource('anime-sem-ep', 99, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);
  });

  it('desembrulha URL legada /embed/media?url=...', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime-legado',
    });
    const innerUrl = 'https://cdn.example.com/v.mp4';
    const wrapped = `http://localhost:3001/embed/media?url=${encodeURIComponent(innerUrl)}`;
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: wrapped,
      embedUrl: null,
      thumbnailUrl: null,
    });

    const result = await svc.getSource(
      'anime-legado',
      1,
      'https://api.animesice.app',
    );
    expect(result.rawVideoUrl).toBe(innerUrl);
  });

  it('usa cache de scrape quando disponível', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'anime-cached',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-cached-1/',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://cdn.example.com/v.mp4'],
      playerTokens: [],
    });
    prisma.episode.update.mockResolvedValue({});

    const result1 = await svc.getSource(
      'anime-cached',
      1,
      'https://api.animesice.app',
    );
    expect(result1.reextracted).toBe(true);

    const result2 = await svc.getSource(
      'anime-cached',
      1,
      'https://api.animesice.app',
    );
    expect(result2.reextracted).toBe(false);
    expect(result2.rawVideoUrl).toBe('https://cdn.example.com/v.mp4');
    expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledTimes(1);
  });

  it('doSingleScrape falha na URL persistida e usa scrapeEpisodeFromRankedSources como fallback, persistindo EpisodeSource e republicando anime', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime-fallback',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-fallback-1/',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockRejectedValue(
      new Error('fonte original falhou'),
    );
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue({
      videoUrl: 'https://fallback.example.com/v.mp4',
      sourceId: 'animesonline',
      pageUrl: 'https://animesonline.cloud/episodio/anime-fallback-1',
    });

    const result = await svc.getSource(
      'anime-fallback',
      1,
      'https://api.animesice.app',
    );
    expect(result.rawVideoUrl).toBe('https://fallback.example.com/v.mp4');
    expect(result.reextracted).toBe(true);
    expect(prisma.episodeSource.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodeId_sourceId: {
            episodeId: 'ep-1',
            sourceId: 'animesonline',
          },
        },
      }),
    );
    expect(prisma.anime.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodes: { some: { id: 'ep-1' } },
          published: false,
        },
      }),
    );
  });

  it('doSingleScrape engole erro de DB no update', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    const trustSpy = jest.spyOn(trustedMediaHosts, 'trustMediaHosts');
    const temporaryTrustSpy = jest.spyOn(trustedMediaHosts, 'trustMediaHost');
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime-db-error',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-db-error-1/',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://cdn.example.com/v.mp4'],
      playerTokens: [],
    });
    prisma.episode.update.mockRejectedValue(new Error('DB error'));

    const result = await svc.getSource(
      'anime-db-error',
      1,
      'https://api.animesice.app',
    );
    expect(result.rawVideoUrl).toBe('https://cdn.example.com/v.mp4');
    expect(result.reextracted).toBe(true);
    expect(trustSpy).not.toHaveBeenCalled();
    expect(temporaryTrustSpy).toHaveBeenCalledWith(
      'https://cdn.example.com/v.mp4',
      expect.any(Number),
    );
    trustSpy.mockRestore();
    temporaryTrustSpy.mockRestore();
  });

  it('mantém 404 quando a fonte persistida e o fallback ranqueado falham', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime-all-fail',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-all-fail-1/',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue(null);

    await expect(
      svc.getSource('anime-all-fail', 1, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);
  });

  it('em 403 no proxyVideo usa scrapeEpisodeFromRankedSources e faz upsert de EpisodeSource', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const expiresAt = new Date(Date.now() + 9999000);
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt,
      episodeId: 'ep-1',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      season: 1,
      videoUrl: 'https://rr1.googlevideo.com/videoplayback?expire=100',
      anime: { slug: 'anime' },
    });
    embedService.proxyMedia
      .mockResolvedValueOnce({ status: 403, headers: {}, body: null })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'video/mp4' },
        body: null,
      });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue({
      videoUrl: 'https://cdn.animesonline.example/v.mp4',
      sourceId: 'animesonline',
      pageUrl: 'https://animesonline.cloud/episodio/anime-1',
    });

    const future = Math.floor(Date.now() / 1000) + 9999;
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(200);
    expect(scrapeService.scrapeEpisodeFromRankedSources).toHaveBeenCalledWith(
      'anime',
      1,
      1,
      undefined,
      expect.any(Function),
    );
    expect(prisma.episodeSource.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodeId_sourceId: {
            episodeId: 'ep-1',
            sourceId: 'animesonline',
          },
        },
      }),
    );
  });
});

describe('StreamingService.getSourceAsync & Job Lease Lifecycle', () => {
  beforeEach(() =>
    jest.spyOn(mediaProbe, 'probeMediaUrlDead').mockResolvedValue(false),
  );
  afterEach(() => jest.restoreAllMocks());

  it('isola uma fonte escolhida e não substitui o vídeo padrão do episódio', async () => {
    const { prisma, scrapeService, jobRows, svc } = makeMocks();
    const trustSpy = jest.spyOn(trustedMediaHosts, 'trustMediaHost');
    const pageUrl = 'https://animesonline.cloud/solo/episodio-1';
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime',
      audio: 'DUBLADO',
      published: true,
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://cdn.default/video.mp4',
      embedUrl: 'https://meusanimes.blog/e/anime-1/',
      thumbnailUrl: null,
    });
    prisma.episodeSource.findMany.mockResolvedValue([
      {
        sourceId: 'animesonline',
        pageUrl,
        audio: 'DUBLADO',
        verifiedAt: new Date(),
        lastError: null,
      },
    ]);
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://cdn.manual/video.mp4'],
    });

    const submitted = await svc.getSourceAsync(
      'anime',
      1,
      1,
      false,
      'animesonline',
    );
    await flush();

    expect(submitted?.availableSources).toEqual([
      { id: 'animesonline', label: 'Animes Online' },
    ]);
    expect([...jobRows.values()][0]).toMatchObject({
      sourceId: 'animesonline',
    });
    expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledWith(
      pageUrl,
      'animesonline',
      false,
      true,
      'DUBLADO',
    );
    expect(scrapeService.scrapeEpisodeFromRankedSources).not.toHaveBeenCalled();
    expect(prisma.episode.update).not.toHaveBeenCalled();
    expect(prisma.episodeSource.upsert).not.toHaveBeenCalled();
    expect(prisma.episodeSource.updateMany).toHaveBeenCalledWith({
      where: {
        episodeId: 'ep-1',
        sourceId: 'animesonline',
        pageUrl,
        audio: 'DUBLADO',
        verifiedAt: { not: null },
        lastError: null,
      },
      data: {
        mediaHost: 'cdn.manual',
        mediaHostVerifiedAt: expect.any(Date),
      },
    });
    expect(trustSpy).toHaveBeenCalledWith('cdn.manual', expect.any(Number));
  });

  it('não confia no host quando o job perdeu o lease antes do commit', async () => {
    const { prisma, jobRows, svc } = makeMocks();
    const trustSpy = jest.spyOn(trustedMediaHosts, 'trustMediaHost');
    jobRows.set('job-1', {
      id: 'job-1',
      status: 'processing',
      lockedBy: 'new-worker',
    });

    await svc['finishExtractionJob'](
      'job-1',
      'old-worker',
      'completed',
      'ep-1',
      {
        videoUrl: 'https://cdn.manual/video.mp4',
        playerEmbed: null,
        sourceId: 'animesonline',
        pageUrl: 'https://animesonline.cloud/ep-1',
        audio: 'DUBLADO',
      },
      null,
    );

    expect(prisma.episodeSource.updateMany).not.toHaveBeenCalled();
    expect(trustSpy).not.toHaveBeenCalled();
  });

  it('só confia no host depois do commit do job', async () => {
    const { prisma, jobRows, svc } = makeMocks();
    const trustSpy = jest.spyOn(trustedMediaHosts, 'trustMediaHost');
    jobRows.set('job-1', {
      id: 'job-1',
      status: 'processing',
      lockedBy: 'worker-1',
      sourceId: 'animesonline',
    });
    prisma.$transaction.mockImplementationOnce(async (work) => {
      await work(prisma);
      throw new Error('commit failed');
    });

    await expect(
      svc['finishExtractionJob'](
        'job-1',
        'worker-1',
        'completed',
        'ep-1',
        {
          videoUrl: 'https://cdn.manual/video.mp4',
          playerEmbed: null,
          sourceId: 'animesonline',
          pageUrl: 'https://animesonline.cloud/ep-1',
          audio: 'DUBLADO',
        },
        null,
      ),
    ).rejects.toThrow('commit failed');

    expect(prisma.episodeSource.updateMany).toHaveBeenCalled();
    expect(trustSpy).not.toHaveBeenCalled();
  });

  it('não confia no host automático antes de confirmar a transação', async () => {
    const { prisma, jobRows, svc } = makeMocks();
    const trustSpy = jest.spyOn(trustedMediaHosts, 'trustMediaHost');
    jobRows.set('job-1', {
      id: 'job-1',
      status: 'processing',
      lockedBy: 'worker-1',
      sourceId: null,
    });
    prisma.$transaction.mockImplementationOnce(async (work) => {
      await work(prisma);
      throw new Error('commit failed');
    });

    await expect(
      svc['finishExtractionJob'](
        'job-1',
        'worker-1',
        'completed',
        'ep-1',
        { videoUrl: 'https://cdn.default/video.mp4', playerEmbed: null },
        null,
      ),
    ).rejects.toThrow('commit failed');

    expect(prisma.episode.update).toHaveBeenCalled();
    expect(trustSpy).not.toHaveBeenCalled();
  });

  it('não anuncia fontes desabilitadas nem fontes incompatíveis com o áudio', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime',
      audio: 'DUBLADO',
      published: true,
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://cdn.default/video.mp4',
      embedUrl: null,
      thumbnailUrl: null,
    });
    prisma.episodeSource.findMany.mockResolvedValue([
      {
        sourceId: 'disabled',
        pageUrl: 'https://disabled.example/e1',
        audio: 'DUBLADO',
      },
    ]);
    scrapeService.isSourceDisabled.mockImplementation(
      async (sourceId?: string) => sourceId === 'disabled',
    );

    const result = await svc.getSourceAsync('anime', 1, 1, true);

    expect(result?.availableSources).toEqual([]);
    expect(prisma.episodeSource.findMany).toHaveBeenCalledWith({
      where: {
        episodeId: 'ep-1',
        audio: 'DUBLADO',
        verifiedAt: { not: null },
        lastError: null,
      },
      select: { sourceId: true, pageUrl: true },
      orderBy: { sourceId: 'asc' },
    });
  });

  it('rejeita uma fonte ausente da lista verificada antes de criar job', async () => {
    const { prisma, svc, jobRows } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime',
      audio: 'DUBLADO',
      published: true,
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
    });

    await expect(
      svc.getSourceAsync('anime', 1, 1, false, 'unknown'),
    ).rejects.toThrow('Servidor indisponível');
    expect(jobRows.size).toBe(0);
  });

  it('executa extração assíncrona e persiste Episode, EpisodeSource, TrustedMediaHosts e republica anime', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    const trustSpy = jest.spyOn(trustedMediaHosts, 'trustMediaHost');
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime',
      audio: 'DUBLADO',
      published: false,
      catalogUnpublished: true,
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-episodio-1/',
      thumbnailUrl: null,
    });
    scrapeService.detectSourceId.mockReturnValue('meusanimes' as any);
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://cdn.example/video.mp4'],
    });

    const res = await svc.getSourceAsync('anime', 1);
    expect(res?.jobId).toBeDefined();
    await flush();

    expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledWith(
      'https://meusanimes.blog/e/anime-episodio-1/',
      undefined,
      false,
      true,
      'DUBLADO',
    );
    expect(trustSpy).toHaveBeenCalledWith('cdn.example', null);
    expect(prisma.episode.update).toHaveBeenCalledWith({
      where: { id: 'ep-1' },
      data: { videoUrl: 'https://cdn.example/video.mp4' },
    });
    expect(prisma.episodeSource.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodeId_sourceId: {
            episodeId: 'ep-1',
            sourceId: 'meusanimes',
          },
        },
      }),
    );
    expect(prisma.anime.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodes: { some: { id: 'ep-1' } },
          published: false,
        },
      }),
    );
  });

  it('lança NotFoundException quando anime não existe ou foi despublicado manualmente', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue(null);
    await expect(svc.getSourceAsync('nao-existe', 1)).rejects.toThrow(
      NotFoundException,
    );

    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'manual-unpub',
      published: false,
      catalogUnpublished: false,
    });
    await expect(svc.getSourceAsync('manual-unpub', 1)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lança NotFoundException quando episódio não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(svc.getSourceAsync('anime', 999)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('retorna null quando videoUrl já está vivo e anime publicado', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime',
      published: true,
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://cdn.example.com/v.mp4',
      embedUrl: null,
      thumbnailUrl: null,
    });
    const result = await svc.getSourceAsync('anime', 1);
    expect(result).toBeNull();
  });

  it('não retorna null no fast-path quando anime está catalogUnpublished=true (força job de validação)', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime',
      published: false,
      catalogUnpublished: true,
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://cdn.example.com/v.mp4',
      embedUrl: null,
      thumbnailUrl: null,
    });
    const result = await svc.getSourceAsync('anime', 1);
    expect(result?.jobId).toBeDefined();
  });

  it('submete extração quando a URL assinada já venceu', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: `https://cdn.example.com/v.mp4?expire=${Math.floor(Date.now() / 1000) - 60}`,
      embedUrl: null,
      thumbnailUrl: null,
    });

    const res = await svc.getSourceAsync('anime', 1);
    expect(res?.jobId).toBeDefined();
  });

  it('renova por job quando o player pede refresh explícito', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://cdn.example.com/v.mp4',
      embedUrl: null,
      thumbnailUrl: null,
    });

    const res = await svc.getSourceAsync('anime', 1, 1, true);
    expect(res?.jobId).toBeDefined();
  });

  it('deduplica jobs concorrentes no banco', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-1/',
      thumbnailUrl: null,
    });
    let release!: (v: { videos: string[] }) => void;
    scrapeService.scrapeEpisodeVideo.mockImplementation(
      () =>
        new Promise<{ videos: string[] }>((res) => {
          release = res;
        }),
    );

    const first = await svc.getSourceAsync('anime', 1);
    const second = await svc.getSourceAsync('anime', 1);
    expect(second?.jobId).toBe(first?.jobId);
    release({ videos: ['https://cdn.example/ok.mp4'] });
    await flush();
  });

  it('isola worker antigo após outra instância reclamar lease expirado (fencing)', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'naruto' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'episode-id',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/naruto-1/',
      thumbnailUrl: null,
    });

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    scrapeService.scrapeEpisodeVideo
      .mockImplementationOnce(async () => {
        await firstGate;
        return { videos: ['https://cdn.example/old-source.mp4'] };
      })
      .mockResolvedValueOnce({
        videos: ['https://cdn.example/new-source.mp4'],
      });

    const submitted = await svc.getSourceAsync('naruto', 1);
    const jobId = submitted!.jobId;
    await flush();

    await prisma.streamExtractionJob.updateMany({
      where: { id: jobId },
      data: { lockedUntil: new Date(Date.now() - 1) },
    });

    await svc.getJobStatus(jobId, 'https://api.test');
    await flush();

    releaseFirst();
    await flush();

    const completed = await svc.getJob(jobId);
    expect(completed?.status).toBe('completed');
    expect(completed?.result?.videoUrl).toBe(
      'https://cdn.example/new-source.mp4',
    );
    expect(prisma.episode.update).toHaveBeenCalledTimes(1);
    expect(prisma.episode.update).toHaveBeenCalledWith({
      where: { id: 'episode-id' },
      data: { videoUrl: 'https://cdn.example/new-source.mp4' },
    });
    svc.onModuleDestroy();
  });

  it('notifica listeners em outra réplica via polling quando job termina', async () => {
    jest.useFakeTimers();
    try {
      const { prisma, scrapeService, svc: first } = makeMocks();
      const second = new StreamingService(
        prisma as any,
        { proxyMedia: jest.fn() } as any,
        scrapeService as any,
      );
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'naruto' });
      prisma.episode.findUnique.mockResolvedValue({
        id: 'ep-1',
        number: 1,
        videoUrl: null,
        embedUrl: 'https://meusanimes.blog/e/naruto-1/',
        thumbnailUrl: null,
      });

      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      scrapeService.scrapeEpisodeVideo.mockImplementationOnce(async () => {
        await pending;
        return { videos: ['https://cdn.example/ok.mp4'] };
      });

      const submitted = await first.getSourceAsync('naruto', 1);
      const listener = jest.fn();
      const unsubscribe = await second.onJobComplete(
        submitted!.jobId,
        listener,
      );
      release();
      await jest.advanceTimersByTimeAsync(2_000);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
      unsubscribe();
      first.onModuleDestroy();
      second.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('desembrulha /embed/media?url= sem bloquear a resposta', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl:
        'https://api.animesice.app/api/embed/media?url=https%3A%2F%2Fcdn.example.com%2Fv.mp4',
      embedUrl: null,
      thumbnailUrl: null,
    });
    const probeSpy = jest
      .spyOn(mediaProbe, 'probeMediaUrlDead')
      .mockResolvedValue(false);
    const result = await svc.getSourceAsync('anime', 1);
    expect(result).toBeNull();
    expect(probeSpy).not.toHaveBeenCalled();
    probeSpy.mockRestore();
  });

  it('mantém videoUrl quando desembrulho falha e submete job por não ser http', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: '/embed/media?url=%ZZ',
      embedUrl: null,
      thumbnailUrl: null,
    });
    const result = await svc.getSourceAsync('anime', 1);
    expect(result?.jobId).toBeDefined();
  });
});

describe('StreamingService.buildSourceResponseFromJob', () => {
  it('usa confiança temporária com expiração baseada na conclusão do job', async () => {
    const { prisma, svc } = makeMocks();
    const trustSpy = jest.spyOn(trustedMediaHosts, 'trustMediaHost');
    const completedAt = Date.now() - 60_000;
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      thumbnailUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-episodio-1/',
    });

    const result = await svc.buildSourceResponseFromJob(
      {
        id: 'job-1',
        animeSlug: 'anime',
        episodeNumber: 1,
        season: 1,
        status: 'completed',
        result: {
          videoUrl: 'https://cdn.example/video.mp4',
          playerEmbed: null,
        },
        error: null,
        createdAt: completedAt - 60_000,
        completedAt,
      },
      'https://api.test',
    );

    expect(result.src).toContain('/api/embed/media?url=');
    expect(result.rawVideoUrl).toBe('https://cdn.example/video.mp4');
    expect(trustSpy).toHaveBeenCalledWith(
      'https://cdn.example/video.mp4',
      completedAt + trustedMediaHosts.MEDIA_HOST_TRUST_TTL_MS,
    );
    trustSpy.mockRestore();
  });
});

describe('StreamingService.getJobStatus', () => {
  beforeEach(() =>
    jest.spyOn(mediaProbe, 'probeMediaUrlDead').mockResolvedValue(false),
  );
  afterEach(() => jest.restoreAllMocks());

  it('retorna null quando job não existe', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.getJobStatus('missing', 'https://api.x'),
    ).resolves.toBeNull();
  });

  it('retorna completed com result quando job tem videoUrl', async () => {
    const { prisma, jobRows, svc } = makeMocks();
    jobRows.set('j1', {
      id: 'j1',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      videoUrl: 'https://cdn.example.com/v.mp4',
      playerEmbed: null,
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
    });
    const out = await svc.getJobStatus('j1', 'https://api.animesice.app');
    expect(out?.status).toBe('completed');
    expect(out?.result?.rawVideoUrl).toBe('https://cdn.example.com/v.mp4');
  });

  it('retorna failed com erro quando construção da fonte falha', async () => {
    const { prisma, jobRows, svc } = makeMocks();
    jobRows.set('j2', {
      id: 'j2',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      videoUrl: 'https://cdn.example.com/v.mp4',
      playerEmbed: null,
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    prisma.anime.findUnique.mockResolvedValue(null);
    const out = await svc.getJobStatus('j2', 'https://api.animesice.app');
    expect(out).toEqual({
      status: 'failed',
      result: null,
      error: 'Não foi possível preparar a fonte do episódio.',
    });
  });

  it('retorna failed quando job termina sem video nem embed', async () => {
    const { jobRows, svc } = makeMocks();
    jobRows.set('j0', {
      id: 'j0',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      videoUrl: null,
      playerEmbed: null,
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    const out = await svc.getJobStatus('j0', 'https://api.x');
    expect(out).toEqual({
      status: 'failed',
      result: null,
      error: 'A extração terminou sem encontrar uma fonte de vídeo.',
    });
  });

  it('retorna failed com erro quando job falhou', async () => {
    const { jobRows, svc } = makeMocks();
    jobRows.set('j3', {
      id: 'j3',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'failed',
      videoUrl: null,
      playerEmbed: null,
      error: 'boom',
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    const out = await svc.getJobStatus('j3', 'https://api.x');
    expect(out).toEqual({
      status: 'failed',
      result: null,
      error: 'Não foi possível extrair o vídeo. Tente novamente.',
    });
  });

  it('retorna status pendente para jobs em andamento', async () => {
    const { jobRows, svc } = makeMocks();
    jobRows.set('j4', {
      id: 'j4',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'processing',
      videoUrl: null,
      playerEmbed: null,
      error: null,
      createdAt: new Date(),
      completedAt: null,
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const out = await svc.getJobStatus('j4', 'https://api.x');
    expect(out).toEqual({ status: 'processing', result: null, error: null });
  });

  it('retoma um job com lease vencido ao consultar o status', async () => {
    const { prisma, jobRows, scrapeService, svc } = makeMocks();
    jobRows.set('expired-job', {
      id: 'expired-job',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'processing',
      videoUrl: null,
      playerEmbed: null,
      error: null,
      createdAt: new Date(),
      completedAt: null,
      lockedUntil: new Date(Date.now() - 1000),
    });
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      embedUrl: 'https://meusanimes.blog/e/anime-1/',
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://cdn.example/resumed.mp4'],
    });

    await svc.getJobStatus('expired-job', 'https://api.test');
    await flush();

    const updated = await svc.getJob('expired-job');
    expect(updated?.status).toBe('completed');
    expect(updated?.result?.videoUrl).toBe('https://cdn.example/resumed.mp4');
  });

  it('retorna embed YouTube direto quando job tem playerEmbed', async () => {
    const { prisma, jobRows, svc } = makeMocks();
    const youtubeEmbed = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
    jobRows.set('jy', {
      id: 'jy',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      videoUrl: null,
      playerEmbed: youtubeEmbed,
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: null,
      thumbnailUrl: 'thumb.jpg',
    });
    const out = await svc.getJobStatus('jy', 'https://api.animesice.app');
    expect(out?.status).toBe('completed');
    expect(out?.result?.src).toBe(youtubeEmbed);
  });

  it('usa proxy de embed quando player não é YouTube', async () => {
    const { prisma, jobRows, svc } = makeMocks();
    const bloggerEmbed = 'https://www.blogger.com/video.g?token=x';
    jobRows.set('jb', {
      id: 'jb',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      videoUrl: null,
      playerEmbed: bloggerEmbed,
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
    });
    const out = await svc.getJobStatus('jb', 'https://api.animesice.app/');
    expect(out?.status).toBe('completed');
    expect(out?.result?.src).toContain('/api/embed/proxy');
  });
});

describe('StreamingService (cobertura de recuperação)', () => {
  let probeSpy: jest.SpyInstance;
  const prevApiPrefix = process.env.API_PREFIX;

  beforeEach(() => {
    probeSpy = jest
      .spyOn(mediaProbe, 'probeMediaUrlDead')
      .mockResolvedValue(false);
  });

  afterEach(() => {
    probeSpy.mockRestore();
    if (prevApiPrefix === undefined) delete process.env.API_PREFIX;
    else process.env.API_PREFIX = prevApiPrefix;
  });

  function mockEpisode(
    prisma: ReturnType<typeof makeMocks>['prisma'],
    overrides: Record<string, unknown> = {},
  ) {
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime/',
      thumbnailUrl: null,
      ...overrides,
    });
  }

  it('serve URL relativa de job sem embrulhar em proxy', async () => {
    const { prisma, jobRows, svc } = makeMocks();
    jobRows.set('jrel', {
      id: 'jrel',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      videoUrl: 'relative/path.mp4',
      playerEmbed: null,
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    mockEpisode(prisma);
    const out = await svc.getJobStatus('jrel', 'https://api.test');
    expect(out?.result?.rawVideoUrl).toBe('relative/path.mp4');
    expect(out?.result?.src).toContain('relative/path.mp4');
  });

  it('usa season padrão quando omitido', async () => {
    const { prisma, svc } = makeMocks();
    mockEpisode(prisma, { videoUrl: 'https://cdn.test/v.mp4' });
    const out = await svc.getSource('anime', 1, 'https://api.test');
    expect(out.rawVideoUrl).toBe('https://cdn.test/v.mp4');
    expect(out.src).toContain('/api/embed/media');
  });

  it('mantém URL legada quando o parâmetro url vem vazio', async () => {
    const { prisma, svc } = makeMocks();
    const legacy = 'https://cdn.test/embed/media?url=';
    mockEpisode(prisma, { videoUrl: legacy });
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.rawVideoUrl).toBe(legacy);
  });

  it('mantém videoUrl quando o desembrulho legado lança', async () => {
    const { prisma, svc } = makeMocks();
    const malformed = 'http://[invalid/embed/media?url=x';
    mockEpisode(prisma, { videoUrl: malformed });
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.rawVideoUrl).toBe(malformed);
  });

  it('descarta cache de scrape expirado e re-extrai', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    (svc as any).scrapeCache.set('anime:1:1:auto', {
      result: { videoUrl: 'https://cdn.old/v.mp4', playerEmbed: null },
      at: 0,
    });
    const fresh = 'https://cdn.test/fresh.mp4';
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({ videos: [fresh] });
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.rawVideoUrl).toBe(fresh);
    expect(out.reextracted).toBe(true);
  });

  async function waitForCall(mockFn: jest.Mock, tries = 1000) {
    for (let i = 0; i < tries && mockFn.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(mockFn).toHaveBeenCalled();
  }

  it('compartilha scrape concorrente em single-flight', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    let release!: (v: { videos: string[] }) => void;
    scrapeService.scrapeEpisodeVideo.mockImplementation(
      () =>
        new Promise<{ videos: string[] }>((res) => {
          release = res;
        }),
    );
    const p1 = svc.getSource('anime', 1, 'https://api.test', 1, false);
    const p2 = svc.getSource('anime', 1, 'https://api.test', 1, false);
    await waitForCall(scrapeService.scrapeEpisodeVideo);
    release({ videos: ['https://cdn.test/shared.mp4'] });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledTimes(1);
    expect(r1.rawVideoUrl).toBe('https://cdn.test/shared.mp4');
    expect(r2.rawVideoUrl).toBe('https://cdn.test/shared.mp4');
  });

  it('mantém 404 quando a extração persistida rejeita com string e o fallback retorna null', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    scrapeService.scrapeEpisodeVideo.mockRejectedValue('boom-string');
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue(null);
    await expect(
      svc.getSource('anime', 1, 'https://api.test', 1, false),
    ).rejects.toThrow(NotFoundException);
  });

  it('mantém 404 quando o fallback ranqueado rejeita com string', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockRejectedValue(
      'boom-string',
    );
    await expect(
      svc.getSource('anime', 1, 'https://api.test', 1, false),
    ).rejects.toThrow(NotFoundException);
  });

  it('passa validador de liveness ao scrapeEpisodeFromRankedSources e usa vídeo vivo retornado', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    probeSpy.mockImplementation((url: string) =>
      Promise.resolve(url.includes('dead')),
    );
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockImplementation(
      async (
        _slug: string,
        _ep: number,
        _season?: number,
        _audio?: unknown,
        validate?: (url: string) => Promise<boolean>,
      ) => {
        if (validate) {
          expect(await validate('https://dead1.test/v.mp4')).toBe(false);
          expect(await validate('https://cdn.test/live4.mp4')).toBe(true);
        }
        return {
          videoUrl: 'https://cdn.test/live4.mp4',
          sourceId: 'animesonline',
          pageUrl: 'https://animesonline.cloud/episodio/anime-1',
        };
      },
    );
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.rawVideoUrl).toBe('https://cdn.test/live4.mp4');
  });

  it('em produção usa o fallback cross-source quando a fonte persistida morre', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { prisma, scrapeService, svc } = makeMocks();
      mockEpisode(prisma);
      scrapeService.scrapeEpisodeVideo.mockResolvedValue({
        videos: [],
        playerTokens: [],
      });
      scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue({
        videoUrl: 'https://cdn.test/prod.mp4',
        sourceId: 'animesonline',
        pageUrl: 'https://animesonline.cloud/episodio/anime-1',
      });
      const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
      expect(out.rawVideoUrl).toBe('https://cdn.test/prod.mp4');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('usa prefixo api padrão no embed de player sem API_PREFIX', async () => {
    delete process.env.API_PREFIX;
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: ['https://www.blogger.com/video.g?token=x'],
    });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue(null);
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.src).toContain('/api/embed/proxy');
  });

  it('usa prefixo api padrão no src sem API_PREFIX', async () => {
    delete process.env.API_PREFIX;
    const { prisma, svc } = makeMocks();
    mockEpisode(prisma, { videoUrl: 'https://cdn.test/v.mp4' });
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.src).toContain('/api/embed/media');
  });

  it('usa proxy de embed do job sem API_PREFIX', async () => {
    delete process.env.API_PREFIX;
    const { prisma, jobRows, svc } = makeMocks();
    jobRows.set('jb2', {
      id: 'jb2',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      videoUrl: null,
      playerEmbed: 'https://www.blogger.com/video.g?token=y',
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    mockEpisode(prisma);
    const out = await svc.getJobStatus('jb2', 'https://api.test');
    expect(out?.result?.src).toContain('/api/embed/proxy');
  });

  it('getSourceAsync retorna null para legada sem url e viva', async () => {
    const { prisma, svc } = makeMocks();
    mockEpisode(prisma, { videoUrl: 'https://cdn.test/embed/media?url=' });
    await expect(svc.getSourceAsync('anime', 1, 1)).resolves.toBeNull();
    expect(prisma.streamExtractionJob.create).not.toHaveBeenCalled();
  });

  it('getJobStatus falha claramente quando episódio sumiu', async () => {
    const { prisma, jobRows, svc } = makeMocks();
    jobRows.set('jg', {
      id: 'jg',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      videoUrl: 'https://cdn.test/v.mp4',
      playerEmbed: null,
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(svc.getJobStatus('jg', 'https://api.test')).resolves.toEqual({
      status: 'failed',
      result: null,
      error: 'Não foi possível preparar a fonte do episódio.',
    });
  });

  function mockValidToken(
    prisma: ReturnType<typeof makeMocks>['prisma'],
    videoUrl = 'https://cdn.test/old.mp4',
  ) {
    const future = Math.floor(Date.now() / 1000) + 9999;
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt: new Date(Date.now() + 9999000),
      episodeId: 'ep-1',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      season: 1,
      embedUrl: 'https://meusanimes.blog/e/anime-1/',
      videoUrl,
      anime: { slug: 'anime' },
    });
    return future;
  }

  function streamBody(status: number) {
    return {
      status,
      headers: {} as Record<string, string>,
      body: new Readable({ read() {} }),
    };
  }

  it('proxyVideo compartilha re-extração concorrente em single-flight', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const future = mockValidToken(prisma);
    embedService.proxyMedia
      .mockResolvedValueOnce(streamBody(403))
      .mockResolvedValueOnce(streamBody(403))
      .mockResolvedValue(streamBody(206));
    let releaseFresh!: (v: { videos: string[] }) => void;
    scrapeService.scrapeEpisodeVideo.mockImplementation(
      () =>
        new Promise<{ videos: string[] }>((res) => {
          releaseFresh = res;
        }),
    );
    const p1 = svc.proxyVideo('tok', future, '127.0.0.1');
    const p2 = svc.proxyVideo('tok', future, '127.0.0.1');
    await waitForCall(scrapeService.scrapeEpisodeVideo);
    releaseFresh({ videos: ['https://cdn.test/fresh.mp4'] });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledTimes(1);
    expect(r1.status).toBe(206);
    expect(r2.status).toBe(206);
  });

  it('proxyVideo usa validador de liveness no fallback ranqueado e persiste o vivo', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const future = mockValidToken(prisma);
    probeSpy.mockImplementation((url: string) =>
      Promise.resolve(url.includes('dead')),
    );
    embedService.proxyMedia
      .mockResolvedValueOnce(streamBody(403))
      .mockResolvedValue(streamBody(200));
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({ videos: [] });
    scrapeService.scrapeEpisodeFromRankedSources.mockImplementation(
      async (
        _slug: string,
        _ep: number,
        _season?: number,
        _audio?: unknown,
        validate?: (url: string) => Promise<boolean>,
      ) => {
        if (validate) {
          expect(await validate('https://dead2.test/v.mp4')).toBe(false);
          expect(await validate('https://cdn.test/final.mp4')).toBe(true);
        }
        return {
          videoUrl: 'https://cdn.test/final.mp4',
          sourceId: 'animesonline',
          pageUrl: 'https://animesonline.cloud/episodio/anime-1',
        };
      },
    );
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(200);
    expect(embedService.proxyMedia).toHaveBeenLastCalledWith(
      'https://cdn.test/final.mp4',
      expect.anything(),
      expect.any(String),
    );
    expect(prisma.episode.update).toHaveBeenCalledWith({
      where: { id: 'ep-1' },
      data: { videoUrl: 'https://cdn.test/final.mp4' },
    });
  });

  it('proxyVideo lança 403 quando reextract e fallback ranqueado retornam null', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const future = mockValidToken(prisma);
    embedService.proxyMedia.mockResolvedValue(streamBody(403));
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({ videos: [] });
    scrapeService.scrapeEpisodeFromRankedSources.mockResolvedValue(null);
    await expect(svc.proxyVideo('tok', future, '127.0.0.1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('proxyVideo engole erro de DB ao persistir fallback', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const future = mockValidToken(prisma);
    embedService.proxyMedia
      .mockResolvedValueOnce(streamBody(403))
      .mockResolvedValue(streamBody(206));
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://cdn.test/fresh2.mp4'],
    });
    prisma.episode.update.mockRejectedValueOnce(new Error('db down'));
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(206);
  });

  it('usa API_PREFIX custom no embed de player do job', async () => {
    process.env.API_PREFIX = 'customapi';
    const { prisma, jobRows, svc } = makeMocks();
    jobRows.set('jb3', {
      id: 'jb3',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      videoUrl: null,
      playerEmbed: 'https://www.blogger.com/video.g?token=z',
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
      lockedUntil: null,
    });
    mockEpisode(prisma);
    const out = await svc.getJobStatus('jb3', 'https://api.test');
    expect(out?.result?.src).toContain('/customapi/embed/proxy');
  });
});
