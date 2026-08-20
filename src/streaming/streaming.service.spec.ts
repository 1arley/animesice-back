import { StreamingService } from './streaming.service';
import { NotFoundException } from '@nestjs/common';
import * as mediaProbe from '@/common/media-probe';

function makeMocks() {
  const prisma = {
    anime: {
      findUnique: jest.fn(),
    },
    episode: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const embedService = {};
  const scrapeService = {
    scrapeEpisodeVideo: jest.fn(),
    scrapeFromMeusanimes: jest.fn(),
  };
  const svc = new StreamingService(
    prisma as any,
    embedService as any,
    scrapeService as any,
  );
  return { prisma, scrapeService, svc };
}

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
});
