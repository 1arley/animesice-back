import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminController } from '@/admin/admin.controller';
import { AdminService } from '@/admin/admin.service';
import { SupabaseService } from '@/upload/supabase.service';

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
  const supabaseService = { uploadVideo: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: adminService },
        { provide: SupabaseService, useValue: supabaseService },
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
      );
    });

    it('lista com busca e valores informados (trim na busca)', async () => {
      adminService.listAnimesForAdmin.mockResolvedValue([]);

      await controller.listAnimes('3', '25', ' naruto ');

      expect(adminService.listAnimesForAdmin).toHaveBeenCalledWith(
        3,
        25,
        'naruto',
      );
    });

    it('limita página mínima a 1 e limite máximo a 200', async () => {
      adminService.listAnimesForAdmin.mockResolvedValue([]);

      await controller.listAnimes('0', '999');

      expect(adminService.listAnimesForAdmin).toHaveBeenCalledWith(
        1,
        200,
        undefined,
      );
    });

    it('usa fallback 1/50 quando os valores não são numéricos', async () => {
      adminService.listAnimesForAdmin.mockResolvedValue([]);

      await controller.listAnimes('abc', 'xyz');

      expect(adminService.listAnimesForAdmin).toHaveBeenCalledWith(
        1,
        50,
        undefined,
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

      await controller.updateEpisode('naruto', 2, { videoUrl: 'url' });

      expect(adminService.updateEpisode).toHaveBeenCalledWith('naruto', 2, {
        videoUrl: 'url',
      });
    });

    it('remove episódio', async () => {
      adminService.deleteEpisode.mockResolvedValue({});

      await controller.deleteEpisode('naruto', 1);

      expect(adminService.deleteEpisode).toHaveBeenCalledWith('naruto', 1);
    });
  });

  describe('uploadEpisodeVideo', () => {
    it('lança BadRequestException quando o arquivo não é enviado', async () => {
      await expect(
        controller.uploadEpisodeVideo('naruto', 1, undefined as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita mimetype não suportado', async () => {
      const file = {
        mimetype: 'text/plain',
        buffer: Buffer.from('nada'),
        originalname: 'x.txt',
      } as any;

      await expect(
        controller.uploadEpisodeVideo('naruto', 1, file),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita mp4 sem magic bytes ftyp', async () => {
      const file = {
        mimetype: 'video/mp4',
        buffer: Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
        originalname: 'x.mp4',
      } as any;

      await expect(
        controller.uploadEpisodeVideo('naruto', 1, file),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('faz upload de mp4 válido e atualiza o episódio', async () => {
      const buffer = Buffer.from([
        0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x70, 0x6d, 0x70, 0x34,
      ]);
      const file = {
        mimetype: 'video/mp4',
        buffer,
        originalname: 'ep1.mp4',
      } as any;
      supabaseService.uploadVideo.mockResolvedValue({
        url: 'https://cdn/ep1.mp4',
        path: 'videos/x.mp4',
      });
      adminService.updateEpisode.mockResolvedValue({});

      await controller.uploadEpisodeVideo('naruto', 1, file);

      expect(supabaseService.uploadVideo).toHaveBeenCalledWith(
        buffer,
        'video/mp4',
        'ep1.mp4',
      );
      expect(adminService.updateEpisode).toHaveBeenCalledWith('naruto', 1, {
        videoUrl: 'https://cdn/ep1.mp4',
      });
    });

    it('aceita .ts (video/mp2t) com sync byte 0x47', async () => {
      const file = {
        mimetype: 'video/mp2t',
        buffer: Buffer.from([0x47, 0, 0, 0]),
        originalname: 'ep1.ts',
      } as any;
      supabaseService.uploadVideo.mockResolvedValue({ url: 'u', path: 'p' });
      adminService.updateEpisode.mockResolvedValue({});

      await controller.uploadEpisodeVideo('naruto', 1, file);

      expect(adminService.updateEpisode).toHaveBeenCalled();
    });

    it('aceita .m3u8 com header #EXTM3U', async () => {
      const file = {
        mimetype: 'application/vnd.apple.mpegurl',
        buffer: Buffer.from('#EXTM3U\n#EXT-X-VERSION:3'),
        originalname: 'ep1.m3u8',
      } as any;
      supabaseService.uploadVideo.mockResolvedValue({ url: 'u', path: 'p' });
      adminService.updateEpisode.mockResolvedValue({});

      await controller.uploadEpisodeVideo('naruto', 1, file);

      expect(adminService.updateEpisode).toHaveBeenCalled();
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
