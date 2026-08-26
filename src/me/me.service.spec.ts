import { NotFoundException, ConflictException } from '@nestjs/common';
import { MeService } from '@/me/me.service';

function makePrisma() {
  const user = {
    findUnique: jest.fn(async () => null) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
    delete: jest.fn(async () => ({})) as jest.Mock,
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
  const watchHistory = { count: jest.fn(async () => 0) as jest.Mock };
  const userAnimeList = { count: jest.fn(async () => 0) as jest.Mock };
  const prisma = {
    user,
    comment,
    rating,
    favorite,
    watchHistory,
    userAnimeList,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

describe('MeService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new MeService(prisma as any);
    return { svc, prisma };
  }

  const userId = 'user-1';

  describe('getProfile', () => {
    it('deve retornar perfil do usuário', async () => {
      const { svc, prisma } = build();
      const expected = { id: userId, name: 'John', email: 'john@test.com' };
      prisma.user.findUnique.mockResolvedValue(expected);
      const result = await svc.getProfile(userId);
      expect(result).toEqual(expected);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        select: expect.objectContaining({ id: true, email: true }),
      });
    });

    it('deve lançar NotFoundException se usuário não existir', async () => {
      const { svc } = build();
      await expect(svc.getProfile('inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfile', () => {
    it('deve atualizar nome e bio', async () => {
      const { svc, prisma } = build();
      const expected = { id: userId, name: 'Novo', bio: 'Bio' };
      prisma.user.update.mockResolvedValue(expected);
      const result = await svc.updateProfile(userId, {
        name: 'Novo',
        bio: 'Bio',
      });
      expect(result).toEqual(expected);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: userId },
          data: { name: 'Novo', bio: 'Bio' },
        }),
      );
    });

    it('deve normalizar e verificar unicidade de userName', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({
        id: userId,
        userName: 'novo-apelido',
      });
      await svc.updateProfile(userId, { userName: '  Novo-Apelido  ' });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { userName: 'novo-apelido' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userName: 'novo-apelido' }),
        }),
      );
    });

    it('deve lançar ConflictException se userName já estiver em uso', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'outro-user',
        userName: 'existente',
      });
      await expect(
        svc.updateProfile(userId, { userName: 'existente' }),
      ).rejects.toThrow(ConflictException);
    });

    it('deve permitir userName se for do próprio usuário', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        userName: 'meu-apelido',
      });
      prisma.user.update.mockResolvedValue({
        id: userId,
        userName: 'meu-apelido',
      });
      const result = await svc.updateProfile(userId, {
        userName: 'meu-apelido',
      });
      expect(result).toBeDefined();
    });

    it('deve ignorar userName vazio e lançar NotFoundException se nada mais para atualizar', async () => {
      const { svc } = build();
      await expect(
        svc.updateProfile(userId, { userName: '   ' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException se nada for atualizado', async () => {
      const { svc } = build();
      await expect(svc.updateProfile(userId, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMyActivity', () => {
    function setupActivity(prisma: ReturnType<typeof makePrisma>) {
      prisma.comment.findMany.mockResolvedValue([
        {
          id: 'c1',
          content: 'test',
          animeId: 'a1',
          episodeId: null,
          parentId: null,
          edited: false,
          status: 'VISIBLE',
          createdAt: new Date('2024-01-03'),
          anime: { slug: 's', title: 'T' },
        },
      ]);
      prisma.rating.findMany.mockResolvedValue([
        {
          score: 8,
          animeId: 'a1',
          anime: { slug: 's', title: 'T' },
          createdAt: new Date('2024-01-02'),
        },
      ]);
      prisma.favorite.findMany.mockResolvedValue([
        {
          animeId: 'a1',
          anime: { slug: 's', title: 'T', coverImage: 'img' },
          createdAt: new Date('2024-01-01'),
        },
      ]);
      prisma.comment.count.mockResolvedValue(1);
      prisma.rating.count.mockResolvedValue(1);
      prisma.favorite.count.mockResolvedValue(1);
    }

    it('deve intercalar atividades ordenadas por data decrescente', async () => {
      const { svc, prisma } = build();
      setupActivity(prisma);
      const result = await svc.getMyActivity(userId, 1, 10);
      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toHaveProperty('type', 'comment');
      expect(result.meta.total).toBe(3);
    });

    it('deve aplicar safeLimit entre 1 e 100', async () => {
      const { svc, prisma } = build();
      setupActivity(prisma);
      const result = await svc.getMyActivity(userId, 1, 999);
      expect(result.meta.limit).toBe(100);
    });
  });

  describe('getMyStats', () => {
    it('deve retornar contagens de todas as atividades', async () => {
      const { svc, prisma } = build();
      prisma.comment.count.mockResolvedValue(5);
      prisma.rating.count.mockResolvedValue(3);
      prisma.favorite.count.mockResolvedValue(2);
      prisma.watchHistory.count.mockResolvedValue(10);
      prisma.userAnimeList.count.mockResolvedValue(1);
      const result = await svc.getMyStats(userId);
      expect(result).toEqual({
        comments: 5,
        ratings: 3,
        favorites: 2,
        watchHistories: 10,
        animeList: 1,
      });
    });
  });

  describe('getMyPublicView', () => {
    it('deve retornar visão pública do perfil', async () => {
      const { svc, prisma } = build();
      const expected = {
        id: userId,
        name: 'John',
        _count: { comments: 1, ratings: 2, favorites: 3, watchHistories: 4 },
      };
      prisma.user.findUnique.mockResolvedValue(expected);
      const result = await svc.getMyPublicView(userId);
      expect(result).toEqual(expected);
    });

    it('deve lançar NotFoundException se usuário não existir', async () => {
      const { svc } = build();
      await expect(svc.getMyPublicView('inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteMe', () => {
    it('deve excluir conta e retornar mensagem', async () => {
      const { svc, prisma } = build();
      const result = await svc.deleteMe(userId);
      expect(result).toEqual({ message: 'Conta excluída com sucesso.' });
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: userId },
      });
    });
  });
});
