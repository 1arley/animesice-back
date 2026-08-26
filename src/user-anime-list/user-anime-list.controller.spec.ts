import { Test, TestingModule } from '@nestjs/testing';
import { UserAnimeListController } from '@/user-anime-list/user-anime-list.controller';
import { UserAnimeListService } from '@/user-anime-list/user-anime-list.service';
import { WatchStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('UserAnimeListController', () => {
  let controller: UserAnimeListController;

  const mockUserAnimeListService = {
    upsert: jest.fn(),
    remove: jest.fn(),
    list: jest.fn(),
    check: jest.fn(),
  };

  const mockReq = {
    user: { id: 'u1', email: 'u1@test.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserAnimeListController],
      providers: [
        {
          provide: UserAnimeListService,
          useValue: mockUserAnimeListService,
        },
      ],
    }).compile();

    controller = module.get<UserAnimeListController>(UserAnimeListController);
    jest.clearAllMocks();
  });

  describe('upsert', () => {
    it('deve delegar upsert com userId, slug e dto', async () => {
      mockUserAnimeListService.upsert.mockResolvedValue({
        id: 'l1',
        anime: { genres: [] },
      });

      const result = await controller.upsert(mockReq, 'anime-slug', {
        status: WatchStatus.WATCHING,
      });

      expect(result).toEqual({ id: 'l1', anime: { genres: [] } });
      expect(mockUserAnimeListService.upsert).toHaveBeenCalledWith(
        'u1',
        'anime-slug',
        { status: WatchStatus.WATCHING },
      );
    });
  });

  describe('remove', () => {
    it('deve delegar remove com userId e slug', async () => {
      mockUserAnimeListService.remove.mockResolvedValue({
        message: 'Removido da lista.',
      });

      const result = await controller.remove(mockReq, 'anime-slug');

      expect(result).toEqual({ message: 'Removido da lista.' });
      expect(mockUserAnimeListService.remove).toHaveBeenCalledWith(
        'u1',
        'anime-slug',
      );
    });
  });

  describe('list', () => {
    it('deve delegar list com page, limit e status', async () => {
      mockUserAnimeListService.list.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 24, totalPages: 0 },
      });

      const result = await controller.list(mockReq, '1', '24', 'WATCHING');

      expect(result.meta.total).toBe(0);
      expect(mockUserAnimeListService.list).toHaveBeenCalledWith(
        'u1',
        '1',
        '24',
        'WATCHING',
      );
    });

    it('deve delegar list sem status quando não informado', async () => {
      mockUserAnimeListService.list.mockResolvedValue({
        data: [],
        meta: {},
      });

      await controller.list(mockReq, '', '', undefined);

      expect(mockUserAnimeListService.list).toHaveBeenCalledWith(
        'u1',
        '',
        '',
        undefined,
      );
    });
  });

  describe('check', () => {
    it('deve delegar check com userId e slug', async () => {
      mockUserAnimeListService.check.mockResolvedValue({
        inList: true,
        status: WatchStatus.WATCHING,
      });

      const result = await controller.check(mockReq, 'anime-slug');

      expect(result).toEqual({
        inList: true,
        status: WatchStatus.WATCHING,
      });
      expect(mockUserAnimeListService.check).toHaveBeenCalledWith(
        'u1',
        'anime-slug',
      );
    });

    it('deve retornar { inList: false } quando não está na lista', async () => {
      mockUserAnimeListService.check.mockResolvedValue({ inList: false });

      const result = await controller.check(mockReq, 'anime-slug');

      expect(result).toEqual({ inList: false });
    });
  });
});
