import { Test, TestingModule } from '@nestjs/testing';
import { FavoriteController } from '@/favorite/favorite.controller';
import { FavoriteService } from '@/favorite/favorite.service';
import { DEFAULT_PAGE } from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('FavoriteController', () => {
  let controller: FavoriteController;

  const mockFavoriteService = {
    toggle: jest.fn(),
    list: jest.fn(),
    check: jest.fn(),
  };

  const mockReq = {
    user: { id: 'u1', email: 'u1@test.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FavoriteController],
      providers: [{ provide: FavoriteService, useValue: mockFavoriteService }],
    }).compile();

    controller = module.get<FavoriteController>(FavoriteController);
    jest.clearAllMocks();
  });

  it('deve delegar toggle com userId do request e slug', async () => {
    mockFavoriteService.toggle.mockResolvedValue({
      favorited: true,
      message: 'Adicionado aos favoritos.',
    });

    const result = await controller.toggle(mockReq, 'anime-slug');

    expect(result).toEqual({
      favorited: true,
      message: 'Adicionado aos favoritos.',
    });
    expect(mockFavoriteService.toggle).toHaveBeenCalledWith('u1', 'anime-slug');
  });

  it('deve delegar list com page e limit do query string', async () => {
    mockFavoriteService.list.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 2, limit: 5, totalPages: 0 },
    });

    const result = await controller.list(mockReq, '2', '5');

    expect(result).toEqual({
      data: [],
      meta: { total: 0, page: 2, limit: 5, totalPages: 0 },
    });
    expect(mockFavoriteService.list).toHaveBeenCalledWith('u1', 2, 5);
  });

  it('deve usar DEFAULT_PAGE quando page não é informado', async () => {
    mockFavoriteService.list.mockResolvedValue({
      data: [],
      meta: { total: 0, page: DEFAULT_PAGE, limit: 24, totalPages: 0 },
    });

    await controller.list(mockReq, '', '');

    expect(mockFavoriteService.list).toHaveBeenCalledWith(
      'u1',
      DEFAULT_PAGE,
      24,
    );
  });

  it('deve usar DEFAULT_PAGE e 24 quando page/limit são inválidos', async () => {
    mockFavoriteService.list.mockResolvedValue({ data: [], meta: {} });

    await controller.list(mockReq, 'abc', 'xyz');

    expect(mockFavoriteService.list).toHaveBeenCalledWith(
      'u1',
      DEFAULT_PAGE,
      24,
    );
  });

  it('deve delegar check com userId e slug', async () => {
    mockFavoriteService.check.mockResolvedValue({ favorited: true });

    const result = await controller.check(mockReq, 'anime-slug');

    expect(result).toEqual({ favorited: true });
    expect(mockFavoriteService.check).toHaveBeenCalledWith('u1', 'anime-slug');
  });
});
