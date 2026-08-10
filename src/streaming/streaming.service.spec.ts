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

  it('não usa videoUrl googlevideo persistido (IP-vinculado, 403 no proxy)', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'voce-so-precisa-matar',
    });
    // videoUrl persistido ANTIGO é googlevideo — não-proxyable.
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl:
        'https://rr3.googlevideo.com/videoplayback?expire=2174176075&ei=x&ip=12.26.53.98',
      embedUrl: 'https://meusanimes.blog/e/all-you-need-is-kill-episodio-1/',
      thumbnailUrl: 'thumb.jpg',
    });
    // Re-extração: mesma fonte agora retorna embed YouTube (sem googlevideo).
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

    // Serviu iframe do embed, não proxy googlevideo.
    expect(result.src).toBe(
      'https://www.youtube-nocookie.com/embed/0YpXN40vIxM',
    );
    // Não persistiu o googlevideo.
    expect(prisma.episode.update).not.toHaveBeenCalled();
    // Acionou re-extração.
    expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalled();
  });

  it('não persiste googlevideo como videoUrl quando chromium extrai (wrap=false)', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'voce-teste',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://meusanimes.blog/e/test-episodio-1/',
      thumbnailUrl: null,
    });
    // Scrape retorna googlevideo como vídeo (simula chromium IP-bound).
    // Caso misterioso onde a única fonte disponível é googlevideo; deve
    // descartar e tentar fallback. Se não houver embed, deve 404.
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://rr3.googlevideo.com/videoplayback?expire=2174176075'],
      playerTokens: [],
    });
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);

    await expect(
      svc.getSource('voce-teste', 1, 'https://api.animesice.app'),
    ).rejects.toThrow(NotFoundException);

    // Não persistiu o googlevideo como videoUrl.
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('MP4 de CDN própria (animefire) — wrap em proxy /embed/media', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'kimetsu-no-yaiba',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: null,
      embedUrl: 'https://animefire.io/animes/kimetsu/1',
      thumbnailUrl: null,
    });
    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://lax-lightspeedst.net/v/kimetsu-ep1.mp4'],
      playerTokens: [],
    });
    scrapeService.scrapeFromMeusanimes.mockResolvedValue(null);

    const result = await svc.getSource(
      'kimetsu-no-yaiba',
      1,
      'https://api.animesice.app',
    );

    expect(result.rawVideoUrl).toBe(
      'https://lax-lightspeedst.net/v/kimetsu-ep1.mp4',
    );
    expect(result.src).toContain('/api/embed/media');
    expect(result.src).toContain('lightspeedst.net');
    // Persistiu como videoUrl (é proxyable).
    expect(prisma.episode.update).toHaveBeenCalled();
  });

  it('upstream 403 do proxy de mídia → re-extrai e usa fonte atualizada', async () => {
    const { prisma, scrapeService, svc } = makeMocks();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'anime-1',
      slug: 'rengoku',
    });
    prisma.episode.findUnique.mockResolvedValue({
      id: 'ep-1',
      number: 1,
      videoUrl: 'https://animefireCDN/v/rengoku.mp4',
      embedUrl: 'https://animefire.io/animes/rengoku/1',
      thumbnailUrl: null,
    });
    // videoUrl inicial está morto (403/expirado) → re-extrai.
    probeSpy.mockResolvedValueOnce(true);

    scrapeService.scrapeEpisodeVideo.mockResolvedValue({
      videos: ['https://pub-c7f4.r2.dev/rengoku-ep1.mp4'],
      playerTokens: [],
    });

    const result = await svc.getSource(
      'rengoku',
      1,
      'https://api.animesice.app',
    );

    expect(result.rawVideoUrl).toBe('https://pub-c7f4.r2.dev/rengoku-ep1.mp4');
    expect(result.reextracted).toBe(true);
    expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalled();
  });
});
