import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationController } from '@/recommendation/recommendation.controller';
import { RecommendationService } from '@/recommendation/recommendation.service';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('RecommendationController', () => {
  let controller: RecommendationController;

  const mockRecommendationService = {
    getPersonalized: jest.fn(),
    getSimilar: jest.fn(),
    getBecauseYouWatched: jest.fn(),
  };

  const mockReq = {
    user: { id: 'u1', email: 'u1@test.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationController],
      providers: [
        {
          provide: RecommendationService,
          useValue: mockRecommendationService,
        },
      ],
    }).compile();

    controller = module.get<RecommendationController>(RecommendationController);
    jest.clearAllMocks();
  });

  describe('getPersonalized', () => {
    it('deve delegar getPersonalized com userId e limit informado', async () => {
      const animes = [{ id: 'a1', genres: [] }];
      mockRecommendationService.getPersonalized.mockResolvedValue(animes);

      const result = await controller.getPersonalized(mockReq, '5');

      expect(result).toEqual(animes);
      expect(mockRecommendationService.getPersonalized).toHaveBeenCalledWith(
        'u1',
        5,
      );
    });

    it('deve usar 20 como padrão quando limit não é informado', async () => {
      mockRecommendationService.getPersonalized.mockResolvedValue([]);

      await controller.getPersonalized(mockReq, undefined);

      expect(mockRecommendationService.getPersonalized).toHaveBeenCalledWith(
        'u1',
        20,
      );
    });
  });

  describe('getSimilar', () => {
    it('deve delegar getSimilar com slug e limit', async () => {
      mockRecommendationService.getSimilar.mockResolvedValue([{ id: 'a1' }]);

      const result = await controller.getSimilar('anime-slug', '5');

      expect(result).toEqual([{ id: 'a1' }]);
      expect(mockRecommendationService.getSimilar).toHaveBeenCalledWith(
        'anime-slug',
        5,
      );
    });

    it('deve usar 12 como padrão quando limit não é informado', async () => {
      mockRecommendationService.getSimilar.mockResolvedValue([]);

      await controller.getSimilar('anime-slug', undefined);

      expect(mockRecommendationService.getSimilar).toHaveBeenCalledWith(
        'anime-slug',
        12,
      );
    });
  });

  describe('getBecauseYouWatched', () => {
    it('deve delegar getBecauseYouWatched com userId e limit', async () => {
      mockRecommendationService.getBecauseYouWatched.mockResolvedValue([
        { id: 'a1' },
      ]);

      const result = await controller.getBecauseYouWatched(mockReq, '5');

      expect(result).toEqual([{ id: 'a1' }]);
      expect(
        mockRecommendationService.getBecauseYouWatched,
      ).toHaveBeenCalledWith('u1', 5);
    });

    it('deve usar 12 como padrão quando limit não é informado', async () => {
      mockRecommendationService.getBecauseYouWatched.mockResolvedValue([]);

      await controller.getBecauseYouWatched(mockReq, undefined);

      expect(
        mockRecommendationService.getBecauseYouWatched,
      ).toHaveBeenCalledWith('u1', 12);
    });
  });
});
