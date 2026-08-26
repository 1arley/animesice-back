import { Test, TestingModule } from '@nestjs/testing';
import { EpisodeController } from '@/episode/episode.controller';
import { EpisodeService } from '@/episode/episode.service';
import { MAX_PAGE_SIZE } from '@/common/constants';

describe('EpisodeController', () => {
  let controller: EpisodeController;

  const mockEpisodeService = {
    findLatest: jest.fn(),
    incrementViews: jest.fn(),
    findByAnimeSlug: jest.fn(),
    findByAnimeSlugAndNumber: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EpisodeController],
      providers: [{ provide: EpisodeService, useValue: mockEpisodeService }],
    }).compile();

    controller = module.get<EpisodeController>(EpisodeController);
    jest.clearAllMocks();
  });

  describe('findLatest', () => {
    it('deve delegar findLatest com limit informado', async () => {
      mockEpisodeService.findLatest.mockResolvedValue([{ id: 'e1' }]);

      const result = await controller.findLatest('5');

      expect(result).toEqual([{ id: 'e1' }]);
      expect(mockEpisodeService.findLatest).toHaveBeenCalledWith(5);
    });

    it('deve usar 12 como padrão quando limit não é informado', async () => {
      mockEpisodeService.findLatest.mockResolvedValue([]);

      await controller.findLatest('');

      expect(mockEpisodeService.findLatest).toHaveBeenCalledWith(12);
    });

    it('deve usar 12 quando limit é inválido ou menor que 1', async () => {
      mockEpisodeService.findLatest.mockResolvedValue([]);

      await controller.findLatest('abc');
      expect(mockEpisodeService.findLatest).toHaveBeenCalledWith(12);

      await controller.findLatest('0');
      expect(mockEpisodeService.findLatest).toHaveBeenCalledWith(12);
    });

    it('deve limitar ao MAX_PAGE_SIZE quando limit é muito grande', async () => {
      mockEpisodeService.findLatest.mockResolvedValue([]);

      await controller.findLatest('9999');

      expect(mockEpisodeService.findLatest).toHaveBeenCalledWith(MAX_PAGE_SIZE);
    });
  });

  describe('incrementViews', () => {
    it('deve delegar incrementViews com slug e número', async () => {
      mockEpisodeService.incrementViews.mockResolvedValue({
        message: 'View incrementada.',
      });

      const result = await controller.incrementViews('anime-slug', 3);

      expect(result).toEqual({ message: 'View incrementada.' });
      expect(mockEpisodeService.incrementViews).toHaveBeenCalledWith(
        'anime-slug',
        3,
      );
    });
  });

  describe('findByAnimeSlug', () => {
    it('deve delegar findByAnimeSlug com o slug', async () => {
      mockEpisodeService.findByAnimeSlug.mockResolvedValue([{ id: 'e1' }]);

      const result = await controller.findByAnimeSlug('anime-slug');

      expect(result).toEqual([{ id: 'e1' }]);
      expect(mockEpisodeService.findByAnimeSlug).toHaveBeenCalledWith(
        'anime-slug',
      );
    });
  });

  describe('findByAnimeSlugAndNumber', () => {
    it('deve delegar findByAnimeSlugAndNumber com slug e número', async () => {
      mockEpisodeService.findByAnimeSlugAndNumber.mockResolvedValue({
        id: 'e1',
      });

      const result = await controller.findByAnimeSlugAndNumber('anime-slug', 3);

      expect(result).toEqual({ id: 'e1' });
      expect(mockEpisodeService.findByAnimeSlugAndNumber).toHaveBeenCalledWith(
        'anime-slug',
        3,
      );
    });
  });
});
