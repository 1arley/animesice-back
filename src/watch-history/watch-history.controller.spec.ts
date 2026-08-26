import { Test, TestingModule } from '@nestjs/testing';
import { WatchHistoryController } from '@/watch-history/watch-history.controller';
import { WatchHistoryService } from '@/watch-history/watch-history.service';
import { UpdateProgressDto } from '@/watch-history/dto/update-progress.dto';
import { DEFAULT_PAGE } from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('WatchHistoryController', () => {
  let controller: WatchHistoryController;

  const mockWatchHistoryService = {
    updateProgress: jest.fn(),
    getContinueWatching: jest.fn(),
    getHistory: jest.fn(),
    deleteHistory: jest.fn(),
  };

  const mockReq = {
    user: { id: 'u1', email: 'u1@test.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WatchHistoryController],
      providers: [
        { provide: WatchHistoryService, useValue: mockWatchHistoryService },
      ],
    }).compile();

    controller = module.get<WatchHistoryController>(WatchHistoryController);
    jest.clearAllMocks();
  });

  describe('updateProgress', () => {
    it('deve delegar updateProgress com userId, slug, number e dto', async () => {
      const dto: UpdateProgressDto = { progress: 100, duration: 120 };
      mockWatchHistoryService.updateProgress.mockResolvedValue({ id: 'wh1' });

      const result = await controller.updateProgress(
        mockReq,
        'anime-slug',
        1,
        dto,
      );

      expect(result).toEqual({ id: 'wh1' });
      expect(mockWatchHistoryService.updateProgress).toHaveBeenCalledWith(
        'u1',
        'anime-slug',
        1,
        dto,
      );
    });
  });

  describe('getContinueWatching', () => {
    it('deve delegar getContinueWatching com limit informado', async () => {
      mockWatchHistoryService.getContinueWatching.mockResolvedValue([
        { episodeId: 'e1' },
      ]);

      const result = await controller.getContinueWatching(mockReq, '5');

      expect(result).toEqual([{ episodeId: 'e1' }]);
      expect(mockWatchHistoryService.getContinueWatching).toHaveBeenCalledWith(
        'u1',
        5,
      );
    });

    it('deve usar 12 como padrão quando limit não é informado', async () => {
      mockWatchHistoryService.getContinueWatching.mockResolvedValue([]);

      await controller.getContinueWatching(mockReq, '');

      expect(mockWatchHistoryService.getContinueWatching).toHaveBeenCalledWith(
        'u1',
        12,
      );
    });

    it('deve usar 12 quando limit é inválido', async () => {
      mockWatchHistoryService.getContinueWatching.mockResolvedValue([]);

      await controller.getContinueWatching(mockReq, 'abc');

      expect(mockWatchHistoryService.getContinueWatching).toHaveBeenCalledWith(
        'u1',
        12,
      );
    });
  });

  describe('getHistory', () => {
    it('deve delegar getHistory com page e limit informados', async () => {
      mockWatchHistoryService.getHistory.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 2, limit: 10, totalPages: 0 },
      });

      const result = await controller.getHistory(mockReq, '2', '10');

      expect(result.meta.page).toBe(2);
      expect(mockWatchHistoryService.getHistory).toHaveBeenCalledWith(
        'u1',
        2,
        10,
      );
    });

    it('deve usar DEFAULT_PAGE e 24 como padrão', async () => {
      mockWatchHistoryService.getHistory.mockResolvedValue({
        data: [],
        meta: {},
      });

      await controller.getHistory(mockReq, '', '');

      expect(mockWatchHistoryService.getHistory).toHaveBeenCalledWith(
        'u1',
        DEFAULT_PAGE,
        24,
      );
    });
  });

  describe('deleteHistory', () => {
    it('deve delegar deleteHistory com userId, slug e number', async () => {
      mockWatchHistoryService.deleteHistory.mockResolvedValue({
        message: 'Removido do histórico.',
      });

      const result = await controller.deleteHistory(mockReq, 'anime-slug', 1);

      expect(result).toEqual({ message: 'Removido do histórico.' });
      expect(mockWatchHistoryService.deleteHistory).toHaveBeenCalledWith(
        'u1',
        'anime-slug',
        1,
      );
    });
  });
});
