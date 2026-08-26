import { NotFoundException } from '@nestjs/common';
import { RatingService } from '@/rating/rating.service';
import { RateAnimeDto } from '@/rating/dto/rate-anime.dto';

function makePrisma() {
  const anime = {
    findUnique: jest.fn(async () => null) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
  };
  const rating = {
    upsert: jest.fn(async () => ({})) as jest.Mock,
    delete: jest.fn(async () => ({})) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    aggregate: jest.fn(async () => ({
      _avg: { score: null },
      _min: { score: null },
      _max: { score: null },
    })) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  return { anime, rating };
}

describe('RatingService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new RatingService(prisma as any);
    return { svc, prisma };
  }

  describe('rate', () => {
    it('deve criar ou atualizar uma avaliação e recalcula o rating do anime', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.rating.upsert.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        animeId: 'a1',
        score: 8,
      });
      prisma.rating.aggregate.mockResolvedValue({
        _avg: { score: 8 },
        _min: { score: 8 },
        _max: { score: 8 },
      });
      prisma.rating.count.mockResolvedValue(1);
      prisma.anime.update.mockResolvedValue({});

      const dto: RateAnimeDto = { score: 8 };
      const result = await svc.rate('u1', 'anime-slug', dto);

      expect(result).toEqual(expect.objectContaining({ score: 8 }));
      expect(prisma.rating.upsert).toHaveBeenCalledWith({
        where: { userId_animeId: { userId: 'u1', animeId: 'a1' } },
        update: { score: 8 },
        create: { userId: 'u1', animeId: 'a1', score: 8 },
      });
      expect(prisma.anime.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { rating: 8 },
      });
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();
      const dto: RateAnimeDto = { score: 8 };

      await expect(svc.rate('u1', 'nao-existe', dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deve remover a avaliação e recalcular o rating', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.rating.delete.mockResolvedValue({});
      prisma.rating.aggregate.mockResolvedValue({
        _avg: { score: null },
        _min: { score: null },
        _max: { score: null },
      });
      prisma.anime.update.mockResolvedValue({});

      const result = await svc.remove('u1', 'anime-slug');

      expect(result).toEqual({ message: 'Avaliação removida.' });
      expect(prisma.rating.delete).toHaveBeenCalledWith({
        where: { userId_animeId: { userId: 'u1', animeId: 'a1' } },
      });
      expect(prisma.anime.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { rating: 0 },
      });
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.remove('u1', 'nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar NotFoundException quando a avaliação não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.rating.delete.mockRejectedValue(
        new Error('Record to delete does not exist'),
      );

      await expect(svc.remove('u1', 'anime-slug')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getUserRating', () => {
    it('deve retornar a avaliação do usuário', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.rating.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        animeId: 'a1',
        score: 8,
      });

      const result = await svc.getUserRating('u1', 'anime-slug');

      expect(result).toEqual(expect.objectContaining({ score: 8 }));
    });

    it('deve retornar null quando o usuário não avaliou', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.rating.findUnique.mockResolvedValue(null);

      const result = await svc.getUserRating('u1', 'anime-slug');

      expect(result).toBeNull();
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.getUserRating('u1', 'nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAnimeStats', () => {
    it('deve retornar estatísticas de avaliação', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.rating.aggregate.mockResolvedValue({
        _avg: { score: 7.5 },
        _min: { score: 3 },
        _max: { score: 10 },
      });
      prisma.rating.count.mockResolvedValue(15);

      const result = await svc.getAnimeStats('anime-slug');

      expect(result).toEqual({
        average: 7.5,
        count: 15,
        min: 3,
        max: 10,
      });
    });

    it('deve retornar nulls quando não há avaliações', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.rating.aggregate.mockResolvedValue({
        _avg: { score: null },
        _min: { score: null },
        _max: { score: null },
      });
      prisma.rating.count.mockResolvedValue(0);

      const result = await svc.getAnimeStats('anime-slug');

      expect(result).toEqual({
        average: null,
        count: 0,
        min: null,
        max: null,
      });
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.getAnimeStats('nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
