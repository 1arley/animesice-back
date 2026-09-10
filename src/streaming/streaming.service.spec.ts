import { StreamingService } from './streaming.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Readable } from 'stream';
import * as mediaProbe from '@/common/media-probe';

function makeMocks() {
  const prisma = {
    anime: { findUnique: jest.fn() },
    episode: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    streamingToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const embedService = { proxyMedia: jest.fn() };
  const scrapeService = {
    scrapeEpisodeVideo: jest.fn(),
    scrapeFromMeusanimes: jest.fn(),
    scrapeFromAnimefire: jest.fn(),
    scrapeFromTioanime: jest.fn(),
    reextractEpisodeVideo: jest.fn(),
  };
  const extractionJobs = {
    submit: jest.fn(),
    findByEpisode: jest.fn(),
    getJob: jest.fn(),
    onComplete: jest.fn(),
  };
  const svc = new StreamingService(
    prisma as any,
    embedService as any,
    scrapeService as any,
    extractionJobs as any,
  );
  return { prisma, embedService, scrapeService, extractionJobs, svc };
}

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

  it('chama purgeExpiredLivenessCache', () => {
    const { svc } = makeMocks();
    svc.cleanupMemoryCaches();
    expect(purgeSpy).toHaveBeenCalled();
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

  it('evict reextractInflight quando excede MAX_INFLIGHT_ENTRIES', () => {
    const { svc } = makeMocks();
    const reextract = (svc as any).reextractInflight as Map<string, any>;
    for (let i = 0; i < 210; i++) {
      reextract.set(`k${i}`, Promise.resolve(null));
    }
    svc.cleanupMemoryCaches();
    expect(reextract.size).toBe(200);
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
      videoUrl: null,
    });
    await expect(svc.generateToken('1', 'anime', '127.0.0.1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('gera token com sucesso e inclui url/token/expires/ip', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      season: 1,
      videoUrl: 'https://cdn.example.com/v.mp4',
    });
    prisma.streamingToken.create.mockResolvedValue({});

    const result = await svc.generateToken('1', 'anime', '10.0.0.1', 3600);

    expect(result.url).toContain('token=');
    expect(result.url).toContain('expires=');
    expect(result.url).toContain('ip=10.0.0.1');
    expect(result.token).toBeDefined();
    expect(result.ip).toBe('10.0.0.1');
    expect(prisma.streamingToken.create).toHaveBeenCalled();
  });

  it('lança NotFoundException para episodeSlug não numérico', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(
      svc.generateToken('abc', 'anime', '127.0.0.1'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('StreamingService.validateToken', () => {
  it('lança ForbiddenException quando timestamp expirado', async () => {
    const { svc } = makeMocks();
    const pastUnix = Math.floor(Date.now() / 1000) - 1000;
    await expect(
      svc.validateToken('tok', pastUnix, '127.0.0.1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lança ForbiddenException quando token não existe no DB', async () => {
    const { prisma, svc } = makeMocks();
    prisma.streamingToken.findUnique.mockResolvedValue(null);
    const future = Math.floor(Date.now() / 1000) + 9999;
    await expect(svc.validateToken('tok', future, '127.0.0.1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lança ForbiddenException quando IP não corresponde', async () => {
    const { prisma, svc } = makeMocks();
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '1.2.3.4',
      expiresAt: new Date(Date.now() + 9999000),
      episodeId: 'ep-1',
    });
    const future = Math.floor(Date.now() / 1000) + 9999;
    await expect(svc.validateToken('tok', future, '5.6.7.8')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lança ForbiddenException quando expiresAt já passou', async () => {
    const { prisma, svc } = makeMocks();
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt: new Date(Date.now() - 5000),
      episodeId: 'ep-1',
    });
    const futureUnix = Math.floor(Date.now() / 1000) + 9999;
    await expect(
      svc.validateToken('tok', futureUnix, '127.0.0.1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lança NotFoundException quando episódio não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt: new Date(Date.now() + 9999000),
      episodeId: 'ep-missing',
    });
    prisma.episode.findUnique.mockResolvedValue(null);
    const future = Math.floor(Date.now() / 1000) + 9999;
    await expect(svc.validateToken('tok', future, '127.0.0.1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lança NotFoundException quando episódio não tem videoUrl', async () => {
    const { prisma, svc } = makeMocks();
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
      videoUrl: null,
      anime: { slug: 'anime' },
    });
    const future = Math.floor(Date.now() / 1000) + 9999;
    await expect(svc.validateToken('tok', future, '127.0.0.1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('retorna dados com sucesso', async () => {
    const { prisma, svc } = makeMocks();
    const expiresAt = new Date(Date.now() + 9999000);
    prisma.streamingToken.findUnique.mockResolvedValue({
      token: 'tok',
      ip: '127.0.0.1',
      expiresAt,
      episodeId: 'ep-1',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 3,
      season: 1,
      videoUrl: 'https://cdn.example.com/v.mp4',
      anime: { slug: 'meu-anime' },
    });
    const future = Math.floor(Date.now() / 1000) + 9999;
    const result = await svc.validateToken('tok', future, '127.0.0.1');
    expect(result.videoUrl).toBe('https://cdn.example.com/v.mp4');
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
    'em %i reextrai e refaz proxy com sucesso',
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
        videoUrl: 'https://rr1.googlevideo.com/videoplayback?expire=100',
        anime: { slug: 'anime' },
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
      scrapeService.reextractEpisodeVideo.mockResolvedValue(
        'https://rr2.googlevideo.com/videoplayback?expire=999999',
      );

      const future = Math.floor(Date.now() / 1000) + 9999;
      const result = await svc.proxyVideo('tok', future, '127.0.0.1');
      expect(result.status).toBe(200);
      expect(scrapeService.reextractEpisodeVideo).toHaveBeenCalledWith(
        'anime',
        1,
        1,
      );
    },
  );

  it('em 403 tenta meusanimes como fallback se reextract retorna null', async () => {
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
    scrapeService.reextractEpisodeVideo.mockResolvedValue(null);
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(
      'https://rr3.googlevideo.com/videoplayback?expire=999999',
    );

    const future = Math.floor(Date.now() / 1000) + 9999;
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(200);
    expect(scrapeService.scrapeFromMeusanimes).toHaveBeenCalledWith(
      'anime',
      1,
      1,
    );
  });

  it('em 403 tenta animefire quando meusanimes também falha', async () => {
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
    scrapeService.reextractEpisodeVideo.mockResolvedValue(null);
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(
      'https://cdn.animefire.example/v.mp4',
    );

    const future = Math.floor(Date.now() / 1000) + 9999;
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(200);
    expect(scrapeService.scrapeFromAnimefire).toHaveBeenCalledWith('anime', 1);
  });

  it('em 403 lança ForbiddenException quando todas as fontes falham', async () => {
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
    scrapeService.reextractEpisodeVideo.mockResolvedValue(null);
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(null);

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

  it('descarta vidcache morta na extração e persiste o fallback utilizável', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    const dead = 'https://vidcache.net:8161/token/video.mp4';
    const live = 'https://cdn.test/fallback.mp4';
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep1',
      number: 1,
      videoUrl: dead,
      embedUrl: 'https://meusanimes.blog/e/anime/',
    });
    probeSpy.mockImplementation((url: string) => Promise.resolve(url === dead));
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({ videos: [dead] });
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(dead);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(live);
    const result = await svc.getSource('anime', 1, 'https://api.test', 1, true);
    expect(result.rawVideoUrl).toBe(live);
    expect(prisma.episode.update).toHaveBeenCalledWith({
      where: { id: 'ep1' },
      data: { videoUrl: live },
    });
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
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);

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
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);

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

  it('preserva Blogger quando fallback meusanimes rejeita (regressão #42)', async () => {
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
    scrapeService.scrapeFromMeusanimes.mockRejectedValue(
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
    expect(scrapeService.scrapeFromMeusanimes).toHaveBeenCalledWith(
      'zenonzard-the-animation',
      1,
      1,
    );
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('preserva YouTube embed quando fallback meusanimes rejeita', async () => {
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
    scrapeService.scrapeFromMeusanimes.mockRejectedValue(new Error('timeout'));

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
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(mp4);

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
    scrapeService.scrapeFromMeusanimes.mockRejectedValue(
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
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);

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

  it('lança NotFoundException quando o anime não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue(null);
    await expect(
      svc.getSource('nao-existe', 1, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);
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

  it('doSingleScrape falha e usa meusanimes como fallback', async () => {
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
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(
      'https://fallback.example.com/v.mp4',
    );

    const result = await svc.getSource(
      'anime-fallback',
      1,
      'https://api.animesice.app',
    );
    expect(result.rawVideoUrl).toBe('https://fallback.example.com/v.mp4');
    expect(result.reextracted).toBe(true);
  });

  it('doSingleScrape engole erro de DB no update', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
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
  });

  it('doSingleScrape usa animefire quando meusanimes também falha', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime-af-fallback',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-af-fallback-1/',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockRejectedValue(
      new Error('fonte original falhou'),
    );
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(
      'https://cdn.animefire.example/v.mp4',
    );

    const result = await svc.getSource(
      'anime-af-fallback',
      1,
      'https://api.animesice.app',
    );
    expect(result.rawVideoUrl).toBe('https://cdn.animefire.example/v.mp4');
    expect(result.reextracted).toBe(true);
    expect(scrapeService.scrapeFromAnimefire).toHaveBeenCalledWith(
      'anime-af-fallback',
      1,
    );
  });

  it('mantém 404 quando todas as fontes (original, meusanimes, animefire) falham', async () => {
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
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(null);

    await expect(
      svc.getSource('anime-all-fail', 1, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);
  });

  it('doSingleScrape usa tioanime quando meusanimes e animefire falham', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime-tio-fallback',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-tio-fallback-1/',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockRejectedValue(
      new Error('fonte original falhou'),
    );
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(null);
    scrapeService.scrapeFromTioanime.mockResolvedValue(
      'https://cdn.tioanime.example/v.mp4',
    );

    const result = await svc.getSource(
      'anime-tio-fallback',
      1,
      'https://api.animesice.app',
    );
    expect(result.rawVideoUrl).toBe('https://cdn.tioanime.example/v.mp4');
    expect(result.reextracted).toBe(true);
    expect(scrapeService.scrapeFromTioanime).toHaveBeenCalledWith(
      'anime-tio-fallback',
      1,
    );
  });

  it('mantém 404 quando todas as 4 fontes falham (incluindo tioanime)', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      slug: 'anime-all-fail-4',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/anime-all-fail-4-1/',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(null);
    scrapeService.scrapeFromTioanime.mockResolvedValue(null);

    await expect(
      svc.getSource('anime-all-fail-4', 1, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);
  });

  it('em 403 tenta tioanime quando meusanimes e animefire falham no proxyVideo', async () => {
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
    scrapeService.reextractEpisodeVideo.mockResolvedValue(null);
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(null);
    scrapeService.scrapeFromTioanime.mockResolvedValue(
      'https://cdn.tioanime.example/v.mp4',
    );

    const future = Math.floor(Date.now() / 1000) + 9999;
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(200);
    expect(scrapeService.scrapeFromTioanime).toHaveBeenCalledWith('anime', 1);
  });
});

describe('StreamingService.getSourceAsync', () => {
  it('lança NotFoundException quando anime não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue(null);
    await expect(svc.getSourceAsync('nao-existe', 1)).rejects.toThrow(
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

  it('retorna null quando videoUrl já está vivo', async () => {
    const { prisma, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://cdn.example.com/v.mp4',
      embedUrl: null,
      thumbnailUrl: null,
    });
    const probeSpy = jest
      .spyOn(mediaProbe, 'probeMediaUrlDead')
      .mockResolvedValue(false);
    const result = await svc.getSourceAsync('anime', 1);
    expect(result).toBeNull();
    probeSpy.mockRestore();
  });

  it('delega o job existente ao claim persistido', async () => {
    const { prisma, extractionJobs, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
    });
    extractionJobs.submit.mockResolvedValue({ id: 'job-1' });
    const result = await svc.getSourceAsync('anime', 1);
    expect(result).toEqual({ jobId: 'job-1' });
    expect(extractionJobs.submit).toHaveBeenCalledWith(
      'anime',
      1,
      1,
      expect.any(Function),
    );
  });

  it('submete novo job quando extração é necessária', async () => {
    const { prisma, extractionJobs, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 2,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/x',
      thumbnailUrl: null,
    });
    extractionJobs.findByEpisode.mockReturnValue(undefined);
    extractionJobs.submit.mockReturnValue({ id: 'job-new' });
    const result = await svc.getSourceAsync('anime', 2);
    expect(result).toEqual({ jobId: 'job-new' });
    expect(extractionJobs.submit).toHaveBeenCalledWith(
      'anime',
      2,
      1,
      expect.any(Function),
    );
  });

  it('submete novo job quando videoUrl está morto', async () => {
    const { prisma, extractionJobs, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://cdn.example.com/dead.mp4',
      embedUrl: null,
      thumbnailUrl: null,
    });
    const probeSpy = jest
      .spyOn(mediaProbe, 'probeMediaUrlDead')
      .mockResolvedValue(true);
    extractionJobs.findByEpisode.mockReturnValue(undefined);
    extractionJobs.submit.mockReturnValue({ id: 'job-dead' });
    const result = await svc.getSourceAsync('anime', 1);
    expect(result).toEqual({ jobId: 'job-dead' });
    probeSpy.mockRestore();
  });

  it('desembrulha /embed/media?url= antes do probe', async () => {
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
    expect(probeSpy).toHaveBeenCalledWith('https://cdn.example.com/v.mp4');
    probeSpy.mockRestore();
  });

  it('mantém videoUrl quando desembrulho falha', async () => {
    const { prisma, extractionJobs, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: '/embed/media?url=%ZZ',
      embedUrl: null,
      thumbnailUrl: null,
    });
    extractionJobs.findByEpisode.mockReturnValue(undefined);
    extractionJobs.submit.mockReturnValue({ id: 'job-malformed' });
    const result = await svc.getSourceAsync('anime', 1);
    expect(result).toEqual({ jobId: 'job-malformed' });
  });
});

describe('StreamingService.getJobStatus', () => {
  it('retorna null quando job não existe', async () => {
    const { extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue(undefined);
    await expect(
      svc.getJobStatus('missing', 'https://api.x'),
    ).resolves.toBeNull();
  });

  it('retorna completed com result quando job tem videoUrl', async () => {
    const { prisma, extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'j1',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      result: { videoUrl: 'https://cdn.example.com/v.mp4', playerEmbed: null },
      error: null,
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

  it('retorna completed sem result quando construção falha', async () => {
    const { prisma, extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'j2',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      result: { videoUrl: 'https://cdn.example.com/v.mp4', playerEmbed: null },
      error: null,
    });
    prisma.anime.findUnique.mockResolvedValue(null);
    const out = await svc.getJobStatus('j2', 'https://api.animesice.app');
    expect(out).toEqual({ status: 'completed', result: null, error: null });
  });

  it('retorna completed sem result quando job não tem video nem embed', async () => {
    const { extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'j0',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      result: { videoUrl: null, playerEmbed: null },
      error: null,
    });
    const out = await svc.getJobStatus('j0', 'https://api.x');
    expect(out).toEqual({ status: 'completed', result: null, error: null });
  });

  it('retorna completed sem result quando job tem result null', async () => {
    const { extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'jn',
      status: 'completed',
      result: null,
      error: null,
    });
    const out = await svc.getJobStatus('jn', 'https://api.x');
    expect(out).toEqual({ status: 'completed', result: null, error: null });
  });

  it('retorna failed com erro do job', async () => {
    const { extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'j3',
      status: 'failed',
      result: null,
      error: 'boom',
    });
    const out = await svc.getJobStatus('j3', 'https://api.x');
    expect(out).toEqual({ status: 'failed', result: null, error: 'boom' });
  });

  it('retorna status pendente para jobs em andamento', async () => {
    const { extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'j4',
      status: 'processing',
      result: null,
      error: null,
    });
    const out = await svc.getJobStatus('j4', 'https://api.x');
    expect(out).toEqual({ status: 'processing', result: null, error: null });
  });

  it('onJobComplete delega para extractionJobs', () => {
    const { extractionJobs, svc } = makeMocks();
    const cleanup = jest.fn();
    extractionJobs.onComplete.mockReturnValue(cleanup);
    const listener = jest.fn();
    const out = svc.onJobComplete('j1', listener);
    expect(extractionJobs.onComplete).toHaveBeenCalledWith('j1', listener);
    expect(out).toBe(cleanup);
  });

  it('retorna embed YouTube direto quando job tem playerEmbed', async () => {
    const { prisma, extractionJobs, svc } = makeMocks();
    const youtubeEmbed = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
    extractionJobs.getJob.mockReturnValue({
      id: 'jy',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      result: { videoUrl: null, playerEmbed: youtubeEmbed },
      error: null,
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
    const { prisma, extractionJobs, svc } = makeMocks();
    const bloggerEmbed = 'https://www.blogger.com/video.g?token=x';
    extractionJobs.getJob.mockReturnValue({
      id: 'jb',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      result: { videoUrl: null, playerEmbed: bloggerEmbed },
      error: null,
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
    const { prisma, extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'jrel',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      result: { videoUrl: 'relative/path.mp4', playerEmbed: null },
      error: null,
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
    (svc as any).scrapeCache.set('anime:1:1', {
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

  it('engole rejeição não-Error da fonte original e usa fallback', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    const live = 'https://cdn.test/live.mp4';
    scrapeService.scrapeEpisodeVideo.mockRejectedValue('boom-string');
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(live);
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.rawVideoUrl).toBe(live);
  });

  it('engole rejeição não-Error do meusanimes e usa animefire', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    const live = 'https://cdn.test/live2.mp4';
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeFromMeusanimes.mockRejectedValue('boom-string');
    scrapeService.scrapeFromAnimefire.mockResolvedValue(live);
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.rawVideoUrl).toBe(live);
  });

  it('descarta fallback meusanimes morto e usa animefire', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    probeSpy.mockImplementation((url: string) =>
      Promise.resolve(url.includes('dead')),
    );
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(
      'https://dead.test/v.mp4',
    );
    scrapeService.scrapeFromAnimefire.mockResolvedValue(
      'https://cdn.test/live3.mp4',
    );
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.rawVideoUrl).toBe('https://cdn.test/live3.mp4');
  });

  it('descarta fallbacks mortos e usa tioanime', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    probeSpy.mockImplementation((url: string) =>
      Promise.resolve(url.includes('dead')),
    );
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(
      'https://dead1.test/v.mp4',
    );
    scrapeService.scrapeFromAnimefire.mockResolvedValue(
      'https://dead2.test/v.mp4',
    );
    scrapeService.scrapeFromTioanime.mockResolvedValue(
      'https://cdn.test/live4.mp4',
    );
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.rawVideoUrl).toBe('https://cdn.test/live4.mp4');
  });

  it('usa prefixo api padrão no embed de player sem API_PREFIX', async () => {
    delete process.env.API_PREFIX;
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: ['https://www.blogger.com/video.g?token=x'],
    });
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(null);
    scrapeService.scrapeFromTioanime.mockResolvedValue(null);
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
    const { prisma, extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'jb2',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      result: {
        videoUrl: null,
        playerEmbed: 'https://www.blogger.com/video.g?token=y',
      },
      error: null,
    });
    mockEpisode(prisma);
    const out = await svc.getJobStatus('jb2', 'https://api.test');
    expect(out?.result?.src).toContain('/api/embed/proxy');
  });

  it('getSourceAsync retorna null para legada sem url e viva', async () => {
    const { prisma, extractionJobs, svc } = makeMocks();
    mockEpisode(prisma, { videoUrl: 'https://cdn.test/embed/media?url=' });
    await expect(svc.getSourceAsync('anime', 1, 1)).resolves.toBeNull();
    expect(extractionJobs.submit).not.toHaveBeenCalled();
  });

  it('getJobStatus sem result quando episódio sumiu', async () => {
    const { prisma, extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'jg',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      result: { videoUrl: 'https://cdn.test/v.mp4', playerEmbed: null },
      error: null,
    });
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'anime' });
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(svc.getJobStatus('jg', 'https://api.test')).resolves.toEqual({
      status: 'completed',
      result: null,
      error: null,
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
    let releaseFresh!: (v: string | null) => void;
    scrapeService.reextractEpisodeVideo.mockImplementation(
      () =>
        new Promise<string | null>((res) => {
          releaseFresh = res;
        }),
    );
    const p1 = svc.proxyVideo('tok', future, '127.0.0.1');
    const p2 = svc.proxyVideo('tok', future, '127.0.0.1');
    await waitForCall(scrapeService.reextractEpisodeVideo);
    releaseFresh('https://cdn.test/fresh.mp4');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(scrapeService.reextractEpisodeVideo).toHaveBeenCalledTimes(1);
    expect(r1.status).toBe(206);
    expect(r2.status).toBe(206);
  });

  it('proxyVideo pula fallbacks mortos e persiste o vivo', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const future = mockValidToken(prisma);
    probeSpy.mockImplementation((url: string) =>
      Promise.resolve(url.includes('dead')),
    );
    embedService.proxyMedia
      .mockResolvedValueOnce(streamBody(403))
      .mockResolvedValue(streamBody(200));
    // reextractEpisodeVideo valida internamente e devolve null p/ URL morta.
    scrapeService.reextractEpisodeVideo.mockResolvedValue(null);
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(
      'https://dead2.test/v.mp4',
    );
    scrapeService.scrapeFromAnimefire.mockResolvedValue(
      'https://dead3.test/v.mp4',
    );
    scrapeService.scrapeFromTioanime.mockResolvedValue(
      'https://cdn.test/final.mp4',
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

  it('proxyVideo lança 403 quando até o tioanime está morto', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const future = mockValidToken(prisma);
    probeSpy.mockImplementation((url: string) =>
      Promise.resolve(url.includes('dead')),
    );
    embedService.proxyMedia.mockResolvedValue(streamBody(403));
    scrapeService.reextractEpisodeVideo.mockResolvedValue(null);
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(
      'https://dead2.test/v.mp4',
    );
    scrapeService.scrapeFromAnimefire.mockResolvedValue(
      'https://dead3.test/v.mp4',
    );
    scrapeService.scrapeFromTioanime.mockResolvedValue(
      'https://dead4.test/v.mp4',
    );
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
    scrapeService.reextractEpisodeVideo.mockResolvedValue(
      'https://cdn.test/fresh2.mp4',
    );
    prisma.episode.update.mockRejectedValueOnce(new Error('db down'));
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(206);
  });

  it('usa tioanime quando fallbacks retornam null', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(null);
    scrapeService.scrapeFromTioanime.mockResolvedValue(
      'https://cdn.test/live5.mp4',
    );
    const out = await svc.getSource('anime', 1, 'https://api.test', 1, false);
    expect(out.rawVideoUrl).toBe('https://cdn.test/live5.mp4');
  });

  it('descarta tioanime morto e mantém 404', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    mockEpisode(prisma);
    probeSpy.mockImplementation((url: string) =>
      Promise.resolve(url.includes('dead')),
    );
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: [],
      playerTokens: [],
    });
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);
    scrapeService.scrapeFromAnimefire.mockResolvedValue(null);
    scrapeService.scrapeFromTioanime.mockResolvedValue(
      'https://dead9.test/v.mp4',
    );
    await expect(
      svc.getSource('anime', 1, 'https://api.test', 1, false),
    ).rejects.toThrow(NotFoundException);
  });

  it('usa API_PREFIX custom no embed de player do job', async () => {
    process.env.API_PREFIX = 'customapi';
    const { prisma, extractionJobs, svc } = makeMocks();
    extractionJobs.getJob.mockReturnValue({
      id: 'jb3',
      animeSlug: 'anime',
      episodeNumber: 1,
      season: 1,
      status: 'completed',
      result: {
        videoUrl: null,
        playerEmbed: 'https://www.blogger.com/video.g?token=z',
      },
      error: null,
    });
    mockEpisode(prisma);
    const out = await svc.getJobStatus('jb3', 'https://api.test');
    expect(out?.result?.src).toContain('/customapi/embed/proxy');
  });

  it('proxyVideo não persiste retry sem sucesso', async () => {
    const { prisma, embedService, scrapeService, svc } = makeMocks();
    const future = mockValidToken(prisma);
    embedService.proxyMedia
      .mockResolvedValueOnce(streamBody(403))
      .mockResolvedValue(streamBody(500));
    scrapeService.reextractEpisodeVideo.mockResolvedValue(
      'https://cdn.test/fresh3.mp4',
    );
    const result = await svc.proxyVideo('tok', future, '127.0.0.1');
    expect(result.status).toBe(500);
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });
});
