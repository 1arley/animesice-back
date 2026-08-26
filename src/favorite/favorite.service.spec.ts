import { NotFoundException } from '@nestjs/common';
import { FavoriteService } from '@/favorite/favorite.service';

function makePrisma() {
  const anime = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const favorite = {
    findUnique: jest.fn(async () => null) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    create: jest.fn(async () => ({})) as jest.Mock,
    delete: jest.fn(async () => ({})) as jest.Mock,
  };
  return {
    anime,
    favorite,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('FavoriteService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new FavoriteService(prisma as any);
    return { svc, prisma };
  }

  describe('toggle', () => {
    it('deve adicionar aos favoritos quando não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.favorite.findUnique.mockResolvedValue(null);
      prisma.favorite.create.mockResolvedValue({});

      const result = await svc.toggle('u1', 'anime-slug');

      expect(result).toEqual({
        favorited: true,
        message: 'Adicionado aos favoritos.',
      });
      expect(prisma.favorite.create).toHaveBeenCalledWith({
        data: { userId: 'u1', animeId: 'a1' },
      });
    });

    it('deve remover dos favoritos quando já existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.favorite.findUnique.mockResolvedValue({
        id: 'f1',
        userId: 'u1',
        animeId: 'a1',
      });
      prisma.favorite.delete.mockResolvedValue({});

      const result = await svc.toggle('u1', 'anime-slug');

      expect(result).toEqual({
        favorited: false,
        message: 'Removido dos favoritos.',
      });
      expect(prisma.favorite.delete).toHaveBeenCalledWith({
        where: { userId_animeId: { userId: 'u1', animeId: 'a1' } },
      });
    });

    it('deve lançar NotFoundException quando anime não existe', async () => {
      const { svc } = build();

      await expect(svc.toggle('u1', 'nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('deve listar favoritos paginados', async () => {
      const { svc, prisma } = build();
      const favorites = [
        {
          id: 'f1',
          userId: 'u1',
          animeId: 'a1',
          createdAt: new Date(),
          anime: { id: 'a1', title: 'Anime 1', genres: [] },
        },
      ];
      prisma.favorite.findMany.mockResolvedValue(favorites);
      prisma.favorite.count.mockResolvedValue(1);

      const result = await svc.list('u1', 1, 24);

      expect(result.data).toEqual([{ id: 'a1', title: 'Anime 1', genres: [] }]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 24,
        totalPages: 1,
      });
    });

    it('deve retornar lista vazia quando não há favoritos', async () => {
      const { svc, prisma } = build();
      prisma.favorite.findMany.mockResolvedValue([]);
      prisma.favorite.count.mockResolvedValue(0);

      const result = await svc.list('u1');

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('deve limitar page ao mínimo 1', async () => {
      const { svc, prisma } = build();
      prisma.favorite.findMany.mockResolvedValue([]);
      prisma.favorite.count.mockResolvedValue(0);

      await svc.list('u1', 0, 24);

      expect(prisma.favorite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('deve limitar limit ao máximo 100 e mínimo 1', async () => {
      const { svc, prisma } = build();
      prisma.favorite.findMany.mockResolvedValue([]);
      prisma.favorite.count.mockResolvedValue(0);

      await svc.list('u1', 1, 999);
      expect(prisma.favorite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );

      await svc.list('u1', 1, 0);
      expect(prisma.favorite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });
  });

  describe('check', () => {
    it('deve retornar { favorited: true } quando está nos favoritos', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.favorite.findUnique.mockResolvedValue({ id: 'f1' });

      const result = await svc.check('u1', 'anime-slug');

      expect(result).toEqual({ favorited: true });
    });

    it('deve retornar { favorited: false } quando não está nos favoritos', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.favorite.findUnique.mockResolvedValue(null);

      const result = await svc.check('u1', 'anime-slug');

      expect(result).toEqual({ favorited: false });
    });

    it('deve lançar NotFoundException quando anime não existe', async () => {
      const { svc } = build();

      await expect(svc.check('u1', 'nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
