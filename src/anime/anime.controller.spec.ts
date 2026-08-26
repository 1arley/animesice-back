import { Test, TestingModule } from '@nestjs/testing';
import { AnimeController } from '@/anime/anime.controller';
import { AnimeService } from '@/anime/anime.service';

describe('AnimeController', () => {
  let controller: AnimeController;

  const mockAnimeService = {
    findAll: jest.fn(),
    findRandom: jest.fn(),
    findTop: jest.fn(),
    findTrending: jest.fn(),
    findRecentlyAdded: jest.fn(),
    findCalendar: jest.fn(),
    findBySlug: jest.fn(),
    findRelated: jest.fn(),
    findStats: jest.fn(),
    findEpisodesBySlug: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnimeController],
      providers: [{ provide: AnimeService, useValue: mockAnimeService }],
    }).compile();

    controller = module.get<AnimeController>(AnimeController);
  });

  describe('findAll', () => {
    it('repassa filtros para o service', async () => {
      mockAnimeService.findAll.mockResolvedValue({ animes: [], total: 0 });
      const filters = { page: '1', limit: '20', search: 'solo' };
      const result = await controller.findAll(filters);
      expect(result).toEqual({ animes: [], total: 0 });
      expect(mockAnimeService.findAll).toHaveBeenCalledWith(filters);
    });
  });

  describe('findRandom', () => {
    it('retorna anime aleatório', async () => {
      mockAnimeService.findRandom.mockResolvedValue({ id: 'a1' });
      const result = await controller.findRandom();
      expect(result).toEqual({ id: 'a1' });
    });
  });

  describe('findTop', () => {
    it('usa limite padrão 20', async () => {
      mockAnimeService.findTop.mockResolvedValue([]);
      await controller.findTop(undefined);
      expect(mockAnimeService.findTop).toHaveBeenCalledWith(20);
    });

    it('usa limite informado', async () => {
      mockAnimeService.findTop.mockResolvedValue([]);
      await controller.findTop('10');
      expect(mockAnimeService.findTop).toHaveBeenCalledWith(10);
    });
  });

  describe('findTrending', () => {
    it('usa defaults de limite e janela', async () => {
      mockAnimeService.findTrending.mockResolvedValue([]);
      await controller.findTrending(undefined, undefined);
      expect(mockAnimeService.findTrending).toHaveBeenCalledWith(20, 7);
    });

    it('usa valores informados', async () => {
      mockAnimeService.findTrending.mockResolvedValue([]);
      await controller.findTrending('15', '30');
      expect(mockAnimeService.findTrending).toHaveBeenCalledWith(15, 30);
    });
  });

  describe('findRecentlyAdded', () => {
    it('usa limite padrão 20', async () => {
      mockAnimeService.findRecentlyAdded.mockResolvedValue([]);
      await controller.findRecentlyAdded(undefined);
      expect(mockAnimeService.findRecentlyAdded).toHaveBeenCalledWith(20);
    });

    it('usa limite informado', async () => {
      mockAnimeService.findRecentlyAdded.mockResolvedValue([]);
      await controller.findRecentlyAdded('5');
      expect(mockAnimeService.findRecentlyAdded).toHaveBeenCalledWith(5);
    });
  });

  describe('findCalendar', () => {
    it('repassa season e year', async () => {
      mockAnimeService.findCalendar.mockResolvedValue([]);
      await controller.findCalendar('WINTER', '2024');
      expect(mockAnimeService.findCalendar).toHaveBeenCalledWith(
        'WINTER',
        '2024',
      );
    });
  });

  describe('findBySlug', () => {
    it('busca anime por slug', async () => {
      mockAnimeService.findBySlug.mockResolvedValue({ id: 'a1', slug: 'solo' });
      const result = await controller.findBySlug('solo');
      expect(result).toEqual({ id: 'a1', slug: 'solo' });
      expect(mockAnimeService.findBySlug).toHaveBeenCalledWith('solo');
    });
  });

  describe('findRelated', () => {
    it('busca relacionados por slug', async () => {
      mockAnimeService.findRelated.mockResolvedValue([]);
      await controller.findRelated('solo');
      expect(mockAnimeService.findRelated).toHaveBeenCalledWith('solo');
    });
  });

  describe('findStats', () => {
    it('busca stats por slug', async () => {
      mockAnimeService.findStats.mockResolvedValue({ favorites: 10 });
      await controller.findStats('solo');
      expect(mockAnimeService.findStats).toHaveBeenCalledWith('solo');
    });
  });

  describe('findEpisodes', () => {
    it('busca episódios por slug', async () => {
      mockAnimeService.findEpisodesBySlug.mockResolvedValue([]);
      await controller.findEpisodes('solo');
      expect(mockAnimeService.findEpisodesBySlug).toHaveBeenCalledWith('solo');
    });
  });
});
