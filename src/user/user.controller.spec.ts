import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserController } from '@/user/user.controller';
import { UserService } from '@/user/user.service';
import { AvatarService } from '@/upload/avatar.service';

describe('UserController', () => {
  let controller: UserController;

  const mockUserService = {
    findAll: jest.fn(),
    findById: jest.fn(),
    getPublicProfile: jest.fn(),
    updateProfileMeta: jest.fn(),
    clearAvatar: jest.fn(),
  };

  const mockAvatarService = {
    save: jest.fn(),
    get: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string) =>
      key === 'PUBLIC_BACKEND_URL'
        ? 'https://api.example.com'
        : key === 'API_PREFIX'
          ? 'api'
          : undefined,
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: AvatarService, useValue: mockAvatarService },
        { provide: ConfigService, useValue: mockConfig },
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
      const req = { user: { id: 'u1' } } as never;
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
      const req = { user: { id: 'u1' } } as never;
      const result = await controller.updateProfileMeta(req, dto);
      expect(mockUserService.updateProfileMeta).toHaveBeenCalledWith('u1', dto);
      expect(result.bio).toBe('nova bio');
    });
  });

  describe('uploadAvatar', () => {
    it('lança BadRequestException quando arquivo ausente', async () => {
      const req = { user: { id: 'u1' } } as never;
      await expect(
        controller.uploadAvatar(req, undefined as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('grava o avatar no banco e retorna a URL pública', async () => {
      const file = {
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        mimetype: 'image/jpeg',
        originalname: 'avatar.jpg',
      } as unknown as Parameters<UserController['uploadAvatar']>[1];
      const req = { user: { id: 'u1' } } as never;
      mockAvatarService.save.mockResolvedValue('/avatars/u1');
      mockUserService.updateProfileMeta.mockResolvedValue({
        id: 'u1',
        avatar: 'https://api.example.com/api/avatars/u1',
      });

      await controller.uploadAvatar(req, file);

      expect(mockAvatarService.save).toHaveBeenCalledWith(
        'u1',
        file.buffer,
        file.mimetype,
      );
      expect(mockUserService.updateProfileMeta).toHaveBeenCalledWith('u1', {
        avatar: 'https://api.example.com/api/avatars/u1',
      });
    });
  });

  describe('deleteAvatar', () => {
    it('limpa o avatar e o arquivo associado', async () => {
      const req = { user: { id: 'u1' } } as never;
      mockUserService.clearAvatar.mockResolvedValue({
        id: 'u1',
        avatar: null,
      });

      const result = await controller.deleteAvatar(req);

      expect(mockUserService.clearAvatar).toHaveBeenCalledWith('u1');
      expect(result.avatar).toBeNull();
    });
  });
});
