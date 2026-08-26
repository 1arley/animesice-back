import { NotFoundException } from '@nestjs/common';
import { EpisodeService } from '@/episode/episode.service';

function makePrisma() {
  const anime = {
    findFirst: jest.fn(async () => null) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const episode = {
    findMany: jest.fn(async () => []) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
  };
  return { anime, episode };
}

describe('EpisodeService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new EpisodeService(prisma as any);
    return { svc, prisma };
  }

  describe('findByAnimeSlug', () => {
    it('deve retornar episódios ordenados por número ascendente', async () => {
      const { svc, prisma } = build();
      prisma.anime.findFirst.mockResolvedValue({ id: 'a1' });
      const episodes = [
        { id: 'e1', number: 1, animeId: 'a1' },
        { id: 'e2', number: 2, animeId: 'a1' },
      ];
      prisma.episode.findMany.mockResolvedValue(episodes);

      const result = await svc.findByAnimeSlug('anime-slug');

      expect(result).toEqual(episodes);
      expect(prisma.anime.findFirst).toHaveBeenCalledWith({
        where: { slug: 'anime-slug', published: true },
        select: { id: true },
      });
      expect(prisma.episode.findMany).toHaveBeenCalledWith({
        where: { animeId: 'a1' },
        orderBy: { number: 'asc' },
      });
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.findByAnimeSlug('nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve retornar lista vazia quando o anime não tem episódios', async () => {
      const { svc, prisma } = build();
      prisma.anime.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.episode.findMany.mockResolvedValue([]);

      const result = await svc.findByAnimeSlug('anime-slug');

      expect(result).toEqual([]);
    });
  });

  describe('findByAnimeSlugAndNumber', () => {
    it('deve retornar o episódio específico com o anime incluso', async () => {
      const { svc, prisma } = build();
      prisma.anime.findFirst.mockResolvedValue({ id: 'a1' });
      const episode = {
        id: 'e1',
        animeId: 'a1',
        season: 1,
        number: 3,
        anime: {},
      };
      prisma.episode.findUnique.mockResolvedValue(episode);

      const result = await svc.findByAnimeSlugAndNumber('anime-slug', 3);

      expect(result).toEqual(episode);
      expect(prisma.episode.findUnique).toHaveBeenCalledWith({
        where: {
          animeId_season_number: { animeId: 'a1', season: 1, number: 3 },
        },
        include: { anime: true },
      });
    });

    it('deve usar a temporada informada', async () => {
      const { svc, prisma } = build();
      prisma.anime.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.episode.findUnique.mockResolvedValue({ id: 'e1', anime: {} });

      await svc.findByAnimeSlugAndNumber('anime-slug', 3, 2);

      expect(prisma.episode.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            animeId_season_number: { animeId: 'a1', season: 2, number: 3 },
          },
        }),
      );
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(
        svc.findByAnimeSlugAndNumber('nao-existe', 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException quando o episódio não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.episode.findUnique.mockResolvedValue(null);

      await expect(
        svc.findByAnimeSlugAndNumber('anime-slug', 999),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('incrementViews', () => {
    it('deve incrementar as views do episódio', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findUnique.mockResolvedValue({ id: 'e1' });
      prisma.episode.update.mockResolvedValue({ id: 'e1', views: 5 });

      const result = await svc.incrementViews('anime-slug', 1);

      expect(result).toEqual({ message: 'View incrementada.' });
      expect(prisma.episode.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { views: { increment: 1 } },
      });
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.incrementViews('nao-existe', 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar NotFoundException quando o episódio não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findUnique.mockResolvedValue(null);

      await expect(svc.incrementViews('anime-slug', 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findLatest', () => {
    it('deve retornar os últimos episódios com o anime incluso', async () => {
      const { svc, prisma } = build();
      const episodes = [{ id: 'e1', anime: {} }];
      prisma.episode.findMany.mockResolvedValue(episodes);

      const result = await svc.findLatest(5);

      expect(result).toEqual(episodes);
      expect(prisma.episode.findMany).toHaveBeenCalledWith({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: { anime: true },
      });
    });

    it('deve usar limit padrão 12 quando não informado', async () => {
      const { svc, prisma } = build();
      prisma.episode.findMany.mockResolvedValue([]);

      await svc.findLatest();

      expect(prisma.episode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 12 }),
      );
    });
  });
});
