import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from '@/user/user.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

describe('UserService', () => {
  let service: UserService;
  let prisma: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createUserDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password123!',
    };

    it('should create a new user successfully', async () => {
      const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
      const createdUser = {
        id: '1',
        name: createUserDto.name,
        email: createUserDto.email,
        password: hashedPassword,
        role: Role.USER,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(createdUser);

      const result = await service.create(createUserDto);

      expect(result).not.toHaveProperty('password');
      expect(result.email).toBe(createUserDto.email);
      expect(result.name).toBe(createUserDto.name);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: createUserDto.email },
      });
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: createUserDto.email,
      });

      await expect(service.create(createUserDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should use default USER role when not specified', async () => {
      const createDtoWithoutRole = {
        name: createUserDto.name,
        email: createUserDto.email,
        password: createUserDto.password,
      };
      const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
      const createdUser = {
        id: '1',
        name: createDtoWithoutRole.name,
        email: createDtoWithoutRole.email,
        password: hashedPassword,
        role: Role.USER,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(createdUser);

      const result = await service.create(createDtoWithoutRole);

      expect(result.role).toBe(Role.USER);
    });
  });

  describe('findById', () => {
    it('should return user by ID without password', async () => {
      const user = {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashedPassword',
        role: Role.USER,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(user);

      const result = await service.findById('1');

      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe('1');
      expect(result.email).toBe('test@example.com');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated users without passwords', async () => {
      const users = [
        {
          id: '1',
          name: 'User 1',
          email: 'user1@example.com',
          role: Role.USER,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          name: 'User 2',
          email: 'user2@example.com',
          role: Role.ADMIN,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaService.$transaction.mockResolvedValue([users, 2]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).not.toHaveProperty('password');
      expect(result.data[1]).not.toHaveProperty('password');
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should handle empty result set', async () => {
      mockPrismaService.$transaction.mockResolvedValue([[], 0]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });

    it('should calculate pagination correctly', async () => {
      const users = Array(15)
        .fill(null)
        .map((_, i) => ({
          id: `${i + 1}`,
          name: `User ${i + 1}`,
          email: `user${i + 1}@example.com`,
          password: `hashed${i + 1}`,
          role: Role.USER,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));

      mockPrismaService.$transaction.mockResolvedValue([
        users.slice(0, 10),
        25,
      ]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(10);
      expect(result.meta.total).toBe(25);
      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('findOne', () => {
    it('should return user by ID without password', async () => {
      const user = {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashedPassword',
        role: Role.USER,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(user);

      const result = await service.findOne('1');

      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe('1');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('should return user by email without password', async () => {
      const user = {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashedPassword',
        role: Role.USER,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(user);

      const result = await service.findByEmail('test@example.com');

      expect(result).not.toHaveProperty('password');
      expect(result.email).toBe('test@example.com');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should throw NotFoundException if user not found by email', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findByEmail('notfound@example.com')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPublicProfile', () => {
    it('should return public profile with counts', async () => {
      const profile = {
        id: '1',
        name: 'Test User',
        userName: 'testuser',
        avatar: 'avatar.jpg',
        bio: 'Hello',
        myAnimeList: 'myanimelist_user',
        createdAt: new Date(),
        _count: { comments: 5, ratings: 3, favorites: 10, watchHistories: 20 },
      };

      mockPrismaService.user.findUnique.mockResolvedValue(profile);

      const result = await service.getPublicProfile('1');

      expect(result).toEqual(profile);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '1' },
          select: expect.objectContaining({ _count: expect.any(Object) }),
        }),
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.getPublicProfile('999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfileMeta', () => {
    it('should update avatar', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        id: '1',
        avatar: 'new.jpg',
      });
      await service.updateProfileMeta('1', {
        avatar: 'new.jpg',
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { avatar: 'new.jpg' } }),
      );
    });

    it('should update bio', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        id: '1',
        bio: 'new bio',
      });
      await service.updateProfileMeta('1', { bio: 'new bio' });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { bio: 'new bio' } }),
      );
    });

    it('should normalize userName', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.update.mockResolvedValue({
        id: '1',
        userName: 'novousername',
      });
      await service.updateProfileMeta('1', {
        userName: '  NovoUsername  ',
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { userName: 'novousername' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userName: 'novousername' } }),
      );
    });

    it('should throw ConflictException if userName already taken', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '2',
        userName: 'taken',
      });
      await expect(
        service.updateProfileMeta('1', { userName: 'taken' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should extract myAnimeList username from URL', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        id: '1',
        myAnimeList: 'myuser',
      });
      await service.updateProfileMeta('1', {
        myAnimeList: 'https://myanimelist.net/profile/MyUser',
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { myAnimeList: 'myuser' } }),
      );
    });

    it('should extract myAnimeList username from @ mention', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        id: '1',
        myAnimeList: 'user',
      });
      await service.updateProfileMeta('1', {
        myAnimeList: '@User',
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { myAnimeList: 'user' } }),
      );
    });

    it('should throw NotFoundException if nothing to update', async () => {
      await expect(service.updateProfileMeta('1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('clearAvatar', () => {
    it('should clear avatar', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        id: '1',
        avatar: null,
      });
      await service.clearAvatar('1');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { avatar: null } }),
      );
    });
  });
});
