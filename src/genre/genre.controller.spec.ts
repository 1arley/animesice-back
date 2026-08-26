import { Test, TestingModule } from '@nestjs/testing';
import { GenreController } from '@/genre/genre.controller';
import { GenreService } from '@/genre/genre.service';

describe('GenreController', () => {
  let controller: GenreController;
  const mockGenreService = {
    findAll: jest.fn(),
    findBySlug: jest.fn(),
    findAnimesBySlug: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GenreController],
      providers: [{ provide: GenreService, useValue: mockGenreService }],
    }).compile();

    controller = module.get<GenreController>(GenreController);
    jest.clearAllMocks();
  });

  it('deve delegar findAll para o serviço', async () => {
    const genres = [{ id: 'g1', name: 'Ação', _count: { animes: 5 } }];
    mockGenreService.findAll.mockResolvedValue(genres);

    const result = await controller.findAll();

    expect(result).toEqual(genres);
    expect(mockGenreService.findAll).toHaveBeenCalled();
  });

  it('deve delegar findBySlug para o serviço', async () => {
    const genre = { id: 'g1', name: 'Ação', slug: 'acao' };
    mockGenreService.findBySlug.mockResolvedValue(genre);

    const result = await controller.findBySlug('acao');

    expect(result).toEqual(genre);
    expect(mockGenreService.findBySlug).toHaveBeenCalledWith('acao');
  });

  it('deve delegar findAnimesBySlug com page e limit', async () => {
    const payload = {
      genre: { id: 'g1', name: 'Ação', slug: 'acao' },
      data: [],
      meta: { total: 0, page: 2, limit: 5, totalPages: 0 },
    };
    mockGenreService.findAnimesBySlug.mockResolvedValue(payload);

    const result = await controller.findAnimesBySlug('acao', '2', '5');

    expect(result).toEqual(payload);
    expect(mockGenreService.findAnimesBySlug).toHaveBeenCalledWith(
      'acao',
      '2',
      '5',
    );
  });
});
