import { Test } from '@nestjs/testing';
import { AdminController } from '@/admin/admin.controller';
import { AdminService } from '@/admin/admin.service';
import { EpisodeService } from '@/episode/episode.service';

describe('AdminController', () => {
  let controller: AdminController;
  const adminService = {
    listAnimesForAdmin: jest.fn(),
    createAnime: jest.fn(),
    importFromAniList: jest.fn(),
    updateAnime: jest.fn(),
    deleteAnime: jest.fn(),
    createEpisode: jest.fn(),
    updateEpisode: jest.fn(),
    deleteEpisode: jest.fn(),
    createGenre: jest.fn(),
  };
  const episodeService = { findByAnimeSlugAndNumber: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: adminService },
        { provide: EpisodeService, useValue: episodeService },
      ],
    }).compile();
    controller = moduleRef.get(AdminController);
  });

  describe('listAnimes', () => {
    it('lista com página e limite padrão', async () => {
      adminService.listAnimesForAdmin.mockResolvedValue([]);

      await controller.listAnimes('', '');

      expect(adminService.listAnimesForAdmin).toHaveBeenCalledWith(
        1,
        50,
        undefined,
        { counts: true },
      );
    });

    it('lista com busca e valores informados (trim na busca)', async () => {
      adminService.listAnimesForAdmin.mockResolvedValue([]);

      await controller.listAnimes('3', '25', ' naruto ');

      expect(adminService.listAnimesForAdmin).toHaveBeenCalledWith(
        3,
        25,
        'naruto',
        { counts: true },
      );
    });

    it('limita página mínima a 1 e limite máximo a 200', async () => {
      adminService.listAnimesForAdmin.mockResolvedValue([]);

      await controller.listAnimes('0', '999');

      expect(adminService.listAnimesForAdmin).toHaveBeenCalledWith(
        1,
        200,
        undefined,
        { counts: true },
      );
    });

    it('usa fallback 1/50 quando os valores não são numéricos', async () => {
      adminService.listAnimesForAdmin.mockResolvedValue([]);

      await controller.listAnimes('abc', 'xyz');

      expect(adminService.listAnimesForAdmin).toHaveBeenCalledWith(
        1,
        50,
        undefined,
        { counts: true },
      );
    });

    it('desliga a contagem de episódios para o autocomplete', async () => {
      adminService.listAnimesForAdmin.mockResolvedValue([]);

      await controller.listAnimes('1', '25', 'naruto', 'false');

      expect(adminService.listAnimesForAdmin).toHaveBeenCalledWith(
        1,
        25,
        'naruto',
        { counts: false },
      );
    });
  });

  describe('anime CRUD', () => {
    it('cria anime', async () => {
      adminService.createAnime.mockResolvedValue({});
      const dto = { slug: 'naruto', title: 'Naruto' };

      await controller.createAnime(dto);

      expect(adminService.createAnime).toHaveBeenCalledWith(dto);
    });

    it('importa anime via AniList', async () => {
      adminService.importFromAniList.mockResolvedValue({});
      const dto = { anilistId: 1 };

      await controller.importAnime(dto);

      expect(adminService.importFromAniList).toHaveBeenCalledWith(dto);
    });

    it('atualiza anime por slug', async () => {
      adminService.updateAnime.mockResolvedValue({});

      await controller.updateAnime('naruto', { title: 'Naruto 2' });

      expect(adminService.updateAnime).toHaveBeenCalledWith('naruto', {
        title: 'Naruto 2',
      });
    });

    it('remove anime por slug', async () => {
      adminService.deleteAnime.mockResolvedValue({
        message: 'Anime removido.',
      });

      await controller.deleteAnime('naruto');

      expect(adminService.deleteAnime).toHaveBeenCalledWith('naruto');
    });
  });

  describe('episódios', () => {
    it('cria episódio para o slug informado', async () => {
      adminService.createEpisode.mockResolvedValue({});

      await controller.createEpisode('naruto', { number: 1 });

      expect(adminService.createEpisode).toHaveBeenCalledWith('naruto', {
        number: 1,
      });
    });

    it('atualiza episódio repassando número e dto', async () => {
      adminService.updateEpisode.mockResolvedValue({});

      await controller.updateEpisode('naruto', 2, undefined, {
        videoUrl: 'url',
      });

      expect(adminService.updateEpisode).toHaveBeenCalledWith(
        'naruto',
        2,
        { videoUrl: 'url' },
        1,
      );
    });

    it('remove episódio', async () => {
      adminService.deleteEpisode.mockResolvedValue({});

      await controller.deleteEpisode('naruto', 1, undefined);

      expect(adminService.deleteEpisode).toHaveBeenCalledWith('naruto', 1, 1);
    });
  });

  describe('genre', () => {
    it('cria gênero', async () => {
      adminService.createGenre.mockResolvedValue({});

      await controller.createGenre({ slug: 'acao', name: 'Ação' });

      expect(adminService.createGenre).toHaveBeenCalledWith({
        slug: 'acao',
        name: 'Ação',
      });
    });
  });
});
