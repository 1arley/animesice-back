import { NotFoundException, BadRequestException } from '@nestjs/common';
import { UsersService } from '@/users/users.service';

function makePrisma() {
  const user = {
    findFirst: jest.fn(async () => null) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const privacySettings = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const comment = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const rating = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const favorite = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const userAnimeList = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const watchHistory = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const follow = {
    findMany: jest.fn(async () => []) as jest.Mock,
  };
  const report = {
    create: jest.fn(async () => ({})) as jest.Mock,
  };
  const prisma = {
    user,
    privacySettings,
    comment,
    rating,
    favorite,
    userAnimeList,
    watchHistory,
    follow,
    report,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $queryRaw: jest.fn(async () => []) as jest.Mock,
  };
  return prisma;
}

describe('UsersService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new UsersService(prisma as any);
    return { svc, prisma };
  }

  const userId = 'user-1';
  const userRow = { id: userId, name: 'John', userName: 'john' };

  describe('getPublicProfile', () => {
    it('deve retornar perfil público', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUnique.mockResolvedValue({
        ...userRow,
        _count: {
          comments: 1,
          ratings: 2,
          favorites: 3,
          watchHistories: 4,
          followers: 0,
          following: 0,
        },
      });
      const result = await svc.getPublicProfile(userId);
      expect(result).toHaveProperty('name', 'John');
    });

    it('deve lançar NotFoundException se privacidade fechar perfil', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        profilePublic: false,
        showActivity: true,
        showFavorites: true,
        showRatings: true,
      });
      await expect(svc.getPublicProfile(userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar NotFoundException se usuário não existir', async () => {
      const { svc } = build();
      await expect(svc.getPublicProfile('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('searchUsers', () => {
    it('deve buscar usuários com ordenação recommended (padrão)', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([{ id: userId }]);
      prisma.user.findMany.mockResolvedValue([
        {
          ...userRow,
          _count: { comments: 0, ratings: 0, favorites: 0, watchHistories: 0 },
        },
      ]);
      prisma.user.count.mockResolvedValue(1);
      const result = await svc.searchUsers(null, undefined, undefined, 1, 10);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { followers: { _count: 'desc' } },
            { comments: { _count: 'desc' } },
            { createdAt: 'desc' },
          ],
        }),
      );
    });

    it('deve aplicar filtro de busca com OR', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([{ id: userId }]);
      await svc.searchUsers(null, 'John', undefined, 1, 10);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: 'John', mode: 'insensitive' } },
              { userName: { contains: 'John', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });

    it('deve marcar isFollowing para usuário logado', async () => {
      const { svc, prisma } = build();
      const currentUserId = 'current';
      const targetId = 'target-1';
      prisma.$queryRaw.mockResolvedValue([{ id: targetId }]);
      prisma.user.findMany.mockResolvedValue([
        {
          id: targetId,
          name: 'T',
          _count: { comments: 0, ratings: 0, favorites: 0, watchHistories: 0 },
        },
      ]);
      prisma.follow.findMany.mockResolvedValue([{ followeeId: targetId }]);
      prisma.user.count.mockResolvedValue(1);
      const result = await svc.searchUsers(
        currentUserId,
        undefined,
        undefined,
        1,
        10,
      );
      expect(result.data[0]).toHaveProperty('isFollowing', true);
    });

    it('deve ordenar por "new"', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([{ id: userId }]);
      await svc.searchUsers(null, undefined, 'new', 1, 10);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'desc' }] }),
      );
    });

    it('deve ordenar por "active"', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([{ id: userId }]);
      await svc.searchUsers(null, undefined, 'active', 1, 10);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { comments: { _count: 'desc' } },
            { ratings: { _count: 'desc' } },
            { watchHistories: { _count: 'desc' } },
            { createdAt: 'desc' },
          ],
        }),
      );
    });
  });

  describe('getUserComments', () => {
    it('deve retornar comentários públicos', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.comment.findMany.mockResolvedValue([
        { id: 'c1', content: 'test', anime: { slug: 's', title: 'T' } },
      ]);
      prisma.comment.count.mockResolvedValue(1);
      const result = await svc.getUserComments(userId, 1, 10);
      expect(result.data).toHaveLength(1);
    });

    it('deve retornar vazio se showActivity for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showActivity: false,
        showFavorites: false,
        showRatings: false,
        profilePublic: false,
      });
      const result = await svc.getUserComments(userId, 1, 10);
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('getUserRatings', () => {
    it('deve retornar avaliações públicas', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.rating.findMany.mockResolvedValue([
        { score: 8, anime: { slug: 's', title: 'T' } },
      ]);
      prisma.rating.count.mockResolvedValue(1);
      const result = await svc.getUserRatings(userId, 1, 10);
      expect(result.data).toHaveLength(1);
    });

    it('deve retornar vazio se showRatings for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showRatings: false,
        showActivity: false,
        showFavorites: false,
        profilePublic: false,
      });
      const result = await svc.getUserRatings(userId, 1, 10);
      expect(result.data).toEqual([]);
    });
  });

  describe('getUserFavorites', () => {
    it('deve retornar favoritos públicos', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.favorite.findMany.mockResolvedValue([
        { anime: { id: 'a1', slug: 's', title: 'T' } },
      ]);
      prisma.favorite.count.mockResolvedValue(1);
      const result = await svc.getUserFavorites(userId, 1, 10);
      expect(result.data).toHaveLength(1);
    });

    it('deve retornar vazio se showFavorites for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showFavorites: false,
        showActivity: false,
        showRatings: false,
        profilePublic: false,
      });
      const result = await svc.getUserFavorites(userId, 1, 10);
      expect(result.data).toEqual([]);
    });
  });

  describe('getUserAnimeList', () => {
    it('deve retornar lista de animes pública', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.userAnimeList.findMany.mockResolvedValue([
        { anime: { id: 'a1', slug: 's', title: 'T' } },
      ]);
      prisma.userAnimeList.count.mockResolvedValue(1);
      const result = await svc.getUserAnimeList(userId, 1, 10, 'WATCHING');
      expect(result.data).toHaveLength(1);
      expect(prisma.userAnimeList.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId, status: 'WATCHING' }),
        }),
      );
    });

    it('deve retornar vazio se showFavorites for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showFavorites: false,
        showActivity: false,
        showRatings: false,
        profilePublic: false,
      });
      const result = await svc.getUserAnimeList(userId, 1, 10);
      expect(result.data).toEqual([]);
    });
  });

  describe('getUserActivity', () => {
    it('deve retornar atividade pública cronológica', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.watchHistory.findMany.mockResolvedValue([
        {
          watchedAt: new Date('2024-01-03'),
          episode: {
            number: 1,
            anime: { slug: 's', title: 'T', coverImage: 'img' },
          },
        },
      ]);
      prisma.rating.findMany.mockResolvedValue([]);
      prisma.favorite.findMany.mockResolvedValue([]);
      prisma.comment.findMany.mockResolvedValue([]);
      prisma.watchHistory.count.mockResolvedValue(1);
      prisma.rating.count.mockResolvedValue(0);
      prisma.favorite.count.mockResolvedValue(0);
      prisma.comment.count.mockResolvedValue(0);
      const result = await svc.getUserActivity(userId, 1, 10);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty('type', 'watch');
      expect(result.meta.total).toBe(1);
    });

    it('deve retornar vazio se showActivity for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showActivity: false,
        showFavorites: false,
        showRatings: false,
        profilePublic: false,
      });
      const result = await svc.getUserActivity(userId, 1, 10);
      expect(result.data).toEqual([]);
    });
  });

  describe('getUserStats', () => {
    it('deve retornar estatísticas públicas', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUnique.mockResolvedValue({
        _count: { comments: 1, ratings: 2, favorites: 3, watchHistories: 4 },
      });
      const result = await svc.getUserStats(userId);
      expect(result).toEqual({
        comments: 1,
        ratings: 2,
        favorites: 3,
        watchHistories: 4,
      });
    });

    it('deve lançar NotFoundException se perfil privado', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        profilePublic: false,
        showActivity: false,
        showFavorites: false,
        showRatings: false,
      });
      await expect(svc.getUserStats(userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('reportUser', () => {
    it('deve denunciar outro usuário', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: 'target' });
      prisma.report.create.mockResolvedValue({ id: 'r1' });
      const result = await svc.reportUser(userId, 'target', 'SPAM', 'notes');
      expect(result).toEqual({ id: 'r1' });
      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reporterId: userId,
            targetType: 'USER',
            targetId: 'target',
          }),
        }),
      );
    });

    it('deve lançar BadRequestException ao denunciar a si mesmo', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      await expect(svc.reportUser(userId, userId, 'SPAM')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar NotFoundException se alvo não existir', async () => {
      const { svc } = build();
      await expect(svc.reportUser(userId, 'x', 'SPAM')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
