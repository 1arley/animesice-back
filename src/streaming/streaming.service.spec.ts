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
    reextractEpisodeVideo: jest.fn(),
  };
  const svc = new StreamingService(
    prisma as any,
    embedService as any,
    scrapeService as any,
  );
  return { prisma, embedService, scrapeService, svc };
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

  it('em 403 reextrai e refaz proxy com sucesso', async () => {
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
        status: 403,
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
  });

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

  it('em 403 lança ForbiddenException quando reextrai e meusanimes falham', async () => {
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
});
