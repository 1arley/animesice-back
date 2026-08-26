import { NotFoundException } from '@nestjs/common';
import { RecommendationService } from '@/recommendation/recommendation.service';

function makePrisma() {
  const rating = {
    findMany: jest.fn(async () => []) as jest.Mock,
  };
  const userAnimeList = {
    findMany: jest.fn(async () => []) as jest.Mock,
  };
  const watchHistory = {
    findMany: jest.fn(async () => []) as jest.Mock,
  };
  const anime = {
    findMany: jest.fn(async () => []) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  return { rating, userAnimeList, watchHistory, anime };
}

describe('RecommendationService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new RecommendationService(prisma as any);
    return { svc, prisma };
  }

  describe('getPersonalized', () => {
    it('deve retornar animes populares quando não há preferências', async () => {
      const { svc, prisma } = build();
      const popular = [{ id: 'a1', genres: [] }];
      prisma.anime.findMany.mockResolvedValue(popular);

      const result = await svc.getPersonalized('u1', 20);

      expect(result).toEqual(popular);
      expect(prisma.anime.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { published: true },
          orderBy: { rating: 'desc' },
          take: 20,
        }),
      );
    });

    it('deve recomendar por gêneros quando há preferências', async () => {
      const { svc, prisma } = build();
      prisma.rating.findMany.mockResolvedValue([
        {
          anime: { genres: [{ id: 'g1', slug: 'acao' }] },
        },
      ]);
      prisma.userAnimeList.findMany
        .mockResolvedValueOnce([
          {
            anime: { genres: [{ id: 'g2', slug: 'comedia' }] },
          },
        ])
        .mockResolvedValueOnce([{ animeId: 'a1' }, { animeId: 'a2' }]);
      prisma.watchHistory.findMany
        .mockResolvedValueOnce([
          {
            episode: {
              anime: { genres: [{ id: 'g1', slug: 'acao' }] },
            },
          },
        ])
        .mockResolvedValueOnce([{ episode: { animeId: 'a3' } }]);
      const candidates = [
        {
          id: 'a4',
          genres: [{ id: 'g1', slug: 'acao' }],
          rating: 9,
          year: 2024,
        },
      ];
      prisma.anime.findMany.mockResolvedValue(candidates);

      const result = await svc.getPersonalized('u1', 20);

      expect(result).toEqual(candidates);
      const arg = prisma.anime.findMany.mock.calls[0][0];
      expect(arg.where.id).toEqual({ notIn: expect.any(Array) });
      expect(arg.where.genres).toEqual({
        some: { id: { in: expect.any(Array) } },
      });
      expect(arg.take).toBe(60);
    });

    it('deve excluir animes já vistos/listados/avaliados', async () => {
      const { svc, prisma } = build();
      prisma.rating.findMany
        .mockResolvedValueOnce([
          { anime: { genres: [{ id: 'g1', slug: 'acao' }] } },
        ])
        .mockResolvedValueOnce([{ animeId: 'a1' }]);
      prisma.userAnimeList.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ animeId: 'a2' }]);
      prisma.watchHistory.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ episode: { animeId: 'a3' } }]);
      prisma.anime.findMany.mockResolvedValue([]);

      await svc.getPersonalized('u1', 20);

      const arg = prisma.anime.findMany.mock.calls[0][0];
      expect(arg.where.id.notIn).toEqual(
        expect.arrayContaining(['a1', 'a2', 'a3']),
      );
    });

    it('deve diversificar por gêneros e preencher com sobras', async () => {
      const { svc, prisma } = build();
      prisma.rating.findMany.mockResolvedValue([
        { anime: { genres: [{ id: 'g1', slug: 'acao' }] } },
      ]);
      prisma.userAnimeList.findMany.mockResolvedValue([]);
      prisma.watchHistory.findMany.mockResolvedValue([]);
      prisma.anime.findMany.mockResolvedValue([
        { id: 'a1', genres: [{ id: 'g1', slug: 'acao' }], rating: 9 },
        { id: 'a2', genres: [{ id: 'g1', slug: 'acao' }], rating: 8 },
      ]);

      const result = await svc.getPersonalized('u1', 1);

      expect(result).toHaveLength(1);
    });
  });

  describe('getSimilar', () => {
    it('deve retornar animes similares por gênero', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({
        id: 'a1',
        year: 2020,
        genres: [{ id: 'g1' }, { id: 'g2' }],
      });
      const candidates = [
        {
          id: 'a2',
          year: 2021,
          rating: 8,
          genres: [
            { id: 'g1', slug: 'acao' },
            { id: 'g3', slug: 'drama' },
          ],
        },
      ];
      prisma.anime.findMany.mockResolvedValue(candidates);

      const result = await svc.getSimilar('anime-slug', 12);

      expect(result).toEqual(candidates);
      expect(prisma.anime.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { not: 'a1' },
            published: true,
            genres: { some: { id: { in: ['g1', 'g2'] } } },
          },
          take: 24,
        }),
      );
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.getSimilar('nao-existe', 12)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve retornar lista vazia quando o anime não tem gêneros', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1', genres: [] });

      const result = await svc.getSimilar('anime-slug', 12);

      expect(result).toEqual([]);
      expect(prisma.anime.findMany).not.toHaveBeenCalled();
    });

    it('deve retornar lista vazia quando não há candidatos', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({
        id: 'a1',
        year: 2020,
        genres: [{ id: 'g1' }],
      });
      prisma.anime.findMany.mockResolvedValue([]);

      const result = await svc.getSimilar('anime-slug', 12);

      expect(result).toEqual([]);
    });
  });

  describe('getBecauseYouWatched', () => {
    it('deve retornar recomendações baseadas no histórico', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([
        {
          episode: {
            animeId: 'a1',
            anime: { genres: [{ id: 'g1' }, { id: 'g2' }] },
          },
        },
      ]);
      const candidates = [{ id: 'a5', genres: [] }];
      prisma.anime.findMany.mockResolvedValue(candidates);

      const result = await svc.getBecauseYouWatched('u1', 12);

      expect(result).toEqual(candidates);
      const arg = prisma.anime.findMany.mock.calls[0][0];
      expect(arg.where.id).toEqual({ notIn: ['a1'] });
      expect(arg.where.genres).toEqual({
        some: { id: { in: expect.arrayContaining(['g1', 'g2']) } },
      });
      expect(arg.take).toBe(12);
    });

    it('deve retornar lista vazia quando não há histórico', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);

      const result = await svc.getBecauseYouWatched('u1', 12);

      expect(result).toEqual([]);
      expect(prisma.anime.findMany).not.toHaveBeenCalled();
    });

    it('deve retornar lista vazia quando não há candidatos', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([
        {
          episode: {
            animeId: 'a1',
            anime: { genres: [{ id: 'g1' }] },
          },
        },
      ]);
      prisma.anime.findMany.mockResolvedValue([]);

      const result = await svc.getBecauseYouWatched('u1', 12);

      expect(result).toEqual([]);
    });
  });
});
