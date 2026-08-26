import { Test, TestingModule } from '@nestjs/testing';
import { RatingController } from '@/rating/rating.controller';
import { RatingService } from '@/rating/rating.service';
import { RateAnimeDto } from '@/rating/dto/rate-anime.dto';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('RatingController', () => {
  let controller: RatingController;

  const mockRatingService = {
    rate: jest.fn(),
    remove: jest.fn(),
    getUserRating: jest.fn(),
    getAnimeStats: jest.fn(),
  };

  const mockReq = {
    user: { id: 'u1', email: 'u1@test.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RatingController],
      providers: [{ provide: RatingService, useValue: mockRatingService }],
    }).compile();

    controller = module.get<RatingController>(RatingController);
    jest.clearAllMocks();
  });

  describe('rate', () => {
    it('deve delegar rate com userId, slug e dto', async () => {
      const dto: RateAnimeDto = { score: 8 };
      mockRatingService.rate.mockResolvedValue({ score: 8 });

      const result = await controller.rate(mockReq, 'anime-slug', dto);

      expect(result).toEqual({ score: 8 });
      expect(mockRatingService.rate).toHaveBeenCalledWith(
        'u1',
        'anime-slug',
        dto,
      );
    });
  });

  describe('remove', () => {
    it('deve delegar remove com userId e slug', async () => {
      mockRatingService.remove.mockResolvedValue({
        message: 'Avaliação removida.',
      });

      const result = await controller.remove(mockReq, 'anime-slug');

      expect(result).toEqual({ message: 'Avaliação removida.' });
      expect(mockRatingService.remove).toHaveBeenCalledWith('u1', 'anime-slug');
    });
  });

  describe('getUserRating', () => {
    it('deve delegar getUserRating com userId e slug', async () => {
      mockRatingService.getUserRating.mockResolvedValue({ score: 8 });

      const result = await controller.getUserRating(mockReq, 'anime-slug');

      expect(result).toEqual({ score: 8 });
      expect(mockRatingService.getUserRating).toHaveBeenCalledWith(
        'u1',
        'anime-slug',
      );
    });
  });

  describe('getStats', () => {
    it('deve delegar getAnimeStats com o slug', async () => {
      mockRatingService.getAnimeStats.mockResolvedValue({
        average: 7.5,
        count: 15,
        min: 3,
        max: 10,
      });

      const result = await controller.getStats('anime-slug');

      expect(result).toEqual({
        average: 7.5,
        count: 15,
        min: 3,
        max: 10,
      });
      expect(mockRatingService.getAnimeStats).toHaveBeenCalledWith(
        'anime-slug',
      );
    });
  });
});
