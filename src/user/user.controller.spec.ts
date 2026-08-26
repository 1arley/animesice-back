import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserController } from '@/user/user.controller';
import { UserService } from '@/user/user.service';
import { SupabaseService } from '@/upload/supabase.service';

describe('UserController', () => {
  let controller: UserController;

  const mockUserService = {
    findAll: jest.fn(),
    findById: jest.fn(),
    getPublicProfile: jest.fn(),
    updateProfileMeta: jest.fn(),
    clearAvatar: jest.fn(),
  };

  const mockSupabaseService = {
    uploadImage: jest.fn(),
    deleteAvatarImage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  describe('findAll', () => {
    it('chama findAll com página e limite parseados', async () => {
      mockUserService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });
      const result = await controller.findAll('2', '20');
      expect(mockUserService.findAll).toHaveBeenCalledWith(2, 20);
      expect(result.meta.page).toBe(1);
    });

    it('usa defaults quando page/limit inválidos', async () => {
      mockUserService.findAll.mockResolvedValue({ data: [], meta: {} });
      await controller.findAll('abc', '0');
      expect(mockUserService.findAll).toHaveBeenCalledWith(1, 10);
    });

    it('capa o limit no máximo', async () => {
      mockUserService.findAll.mockResolvedValue({ data: [], meta: {} });
      await controller.findAll('1', '99999');
      expect(mockUserService.findAll).toHaveBeenCalledWith(1, 100);
    });
  });

  describe('getProfile', () => {
    it('chama findById com o id do usuário autenticado', async () => {
      mockUserService.findById.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
      });
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.getProfile(req);
      expect(mockUserService.findById).toHaveBeenCalledWith('u1');
      expect(result.id).toBe('u1');
    });
  });

  describe('getPublicProfile', () => {
    it('chama getPublicProfile com o id do param', async () => {
      mockUserService.getPublicProfile.mockResolvedValue({
        id: 'u2',
        name: 'Bia',
      });
      const result = await controller.getPublicProfile('u2');
      expect(mockUserService.getPublicProfile).toHaveBeenCalledWith('u2');
      expect(result.name).toBe('Bia');
    });
  });

  describe('updateProfileMeta', () => {
    it('chama updateProfileMeta com userId e dto', async () => {
      const dto = { bio: 'nova bio' };
      mockUserService.updateProfileMeta.mockResolvedValue({
        id: 'u1',
        bio: 'nova bio',
      });
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.updateProfileMeta(req, dto);
      expect(mockUserService.updateProfileMeta).toHaveBeenCalledWith('u1', dto);
      expect(result.bio).toBe('nova bio');
    });
  });

  describe('uploadAvatar', () => {
    it('lança BadRequestException quando arquivo ausente', async () => {
      const req = { user: { id: 'u1' } } as any;
      await expect(
        controller.uploadAvatar(req, undefined as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('faz upload e remove avatar antigo quando já existia', async () => {
      const file = {
        buffer: Buffer.from('img'),
        mimetype: 'image/jpeg',
        originalname: 'avatar.jpg',
      } as any;
      const req = { user: { id: 'u1' } } as any;
      mockSupabaseService.uploadImage.mockResolvedValue({
        url: 'https://cdn.example/avatar.jpg',
      });
      mockUserService.findById.mockResolvedValue({
        id: 'u1',
        avatar: 'https://cdn.example/old.jpg',
      });
      mockUserService.updateProfileMeta.mockResolvedValue({
        id: 'u1',
        avatar: 'https://cdn.example/avatar.jpg',
      });

      await controller.uploadAvatar(req, file);

      expect(mockSupabaseService.uploadImage).toHaveBeenCalledWith(
        file.buffer,
        file.mimetype,
        file.originalname,
        'u1',
      );
      expect(mockSupabaseService.deleteAvatarImage).toHaveBeenCalledWith(
        'https://cdn.example/old.jpg',
      );
      expect(mockUserService.updateProfileMeta).toHaveBeenCalledWith('u1', {
        avatar: 'https://cdn.example/avatar.jpg',
      });
    });

    it('faz upload sem remover avatar antigo quando não existia', async () => {
      const file = {
        buffer: Buffer.from('img'),
        mimetype: 'image/png',
        originalname: 'avatar.png',
      } as any;
      const req = { user: { id: 'u1' } } as any;
      mockSupabaseService.uploadImage.mockResolvedValue({
        url: 'https://cdn.example/avatar.png',
      });
      mockUserService.findById.mockResolvedValue({
        id: 'u1',
        avatar: null,
      });
      mockUserService.updateProfileMeta.mockResolvedValue({
        id: 'u1',
        avatar: 'https://cdn.example/avatar.png',
      });

      await controller.uploadAvatar(req, file);

      expect(mockSupabaseService.uploadImage).toHaveBeenCalled();
      expect(mockSupabaseService.deleteAvatarImage).not.toHaveBeenCalled();
    });
  });

  describe('deleteAvatar', () => {
    it('remove imagem do storage e limpa avatar quando existia', async () => {
      const req = { user: { id: 'u1' } } as any;
      mockUserService.findById.mockResolvedValue({
        id: 'u1',
        avatar: 'https://cdn.example/avatar.jpg',
      });
      mockUserService.clearAvatar.mockResolvedValue({
        id: 'u1',
        avatar: null,
      });

      const result = await controller.deleteAvatar(req);

      expect(mockSupabaseService.deleteAvatarImage).toHaveBeenCalledWith(
        'https://cdn.example/avatar.jpg',
      );
      expect(mockUserService.clearAvatar).toHaveBeenCalledWith('u1');
      expect(result.avatar).toBeNull();
    });

    it('não chama storage quando não havia avatar', async () => {
      const req = { user: { id: 'u1' } } as any;
      mockUserService.findById.mockResolvedValue({
        id: 'u1',
        avatar: null,
      });
      mockUserService.clearAvatar.mockResolvedValue({
        id: 'u1',
        avatar: null,
      });

      await controller.deleteAvatar(req);

      expect(mockSupabaseService.deleteAvatarImage).not.toHaveBeenCalled();
      expect(mockUserService.clearAvatar).toHaveBeenCalledWith('u1');
    });
  });
});
