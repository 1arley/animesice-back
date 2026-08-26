import { NotFoundException } from '@nestjs/common';
import { WatchStatus } from '@prisma/client';
import { UserAnimeListService } from '@/user-anime-list/user-anime-list.service';
import { UpdateUserAnimeListDto } from '@/user-anime-list/dto/update-user-anime-list.dto';

function makePrisma() {
  const anime = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const userAnimeList = {
    upsert: jest.fn(async () => ({})) as jest.Mock,
    delete: jest.fn(async () => ({})) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  return {
    anime,
    userAnimeList,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('UserAnimeListService', () => {
  function build() {
    const prisma = makePrisma();
    const notificationService = { create: jest.fn() };
    const svc = new UserAnimeListService(
      prisma as any,
      notificationService as any,
    );
    return { svc, prisma };
  }

  describe('upsert', () => {
    it('deve criar item na lista com valores padrão', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1', title: 'Anime 1' });
      const item = { id: 'l1', animeId: 'a1', anime: { genres: [] } };
      prisma.userAnimeList.upsert.mockResolvedValue(item);

      const dto: UpdateUserAnimeListDto = { status: WatchStatus.WATCHING };
      const result = await svc.upsert('u1', 'anime-slug', dto);

      expect(result).toEqual(item);
      const args = prisma.userAnimeList.upsert.mock.calls[0][0];
      expect(args.where).toEqual({
        userId_animeId: { userId: 'u1', animeId: 'a1' },
      });
      expect(args.create).toEqual(
        expect.objectContaining({
          userId: 'u1',
          animeId: 'a1',
          status: WatchStatus.WATCHING,
          episodesWatched: 0,
          rewatchCount: 0,
          private: false,
        }),
      );
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.upsert('u1', 'nao-existe', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve usar status PLANNING quando não informado', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1', title: 'Anime 1' });
      prisma.userAnimeList.upsert.mockResolvedValue({});

      await svc.upsert('u1', 'anime-slug', {});

      const args = prisma.userAnimeList.upsert.mock.calls[0][0];
      expect(args.create.status).toBe(WatchStatus.PLANNING);
    });

    it('deve definir completedAt quando status é COMPLETED', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1', title: 'Anime 1' });
      prisma.userAnimeList.upsert.mockResolvedValue({});

      const dto: UpdateUserAnimeListDto = { status: WatchStatus.COMPLETED };
      await svc.upsert('u1', 'anime-slug', dto);

      const args = prisma.userAnimeList.upsert.mock.calls[0][0];
      expect(args.create.completedAt).toBeInstanceOf(Date);
      expect(args.update.completedAt).toBeInstanceOf(Date);
    });

    it('deve converter startedAt/completedAt strings para Date', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1', title: 'Anime 1' });
      prisma.userAnimeList.upsert.mockResolvedValue({});

      const dto: UpdateUserAnimeListDto = {
        startedAt: '2024-01-01T00:00:00.000Z',
        completedAt: '2024-02-01T00:00:00.000Z',
      };
      await svc.upsert('u1', 'anime-slug', dto);

      const args = prisma.userAnimeList.upsert.mock.calls[0][0];
      expect(args.create.startedAt).toEqual(
        new Date('2024-01-01T00:00:00.000Z'),
      );
      expect(args.create.completedAt).toEqual(
        new Date('2024-02-01T00:00:00.000Z'),
      );
    });
  });

  describe('remove', () => {
    it('deve remover o item da lista', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.userAnimeList.delete.mockResolvedValue({});

      const result = await svc.remove('u1', 'anime-slug');

      expect(result).toEqual({ message: 'Removido da lista.' });
      expect(prisma.userAnimeList.delete).toHaveBeenCalledWith({
        where: { userId_animeId: { userId: 'u1', animeId: 'a1' } },
      });
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.remove('u1', 'nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar NotFoundException quando o item não existe na lista', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.userAnimeList.delete.mockRejectedValue(
        new Error('Record to delete does not exist'),
      );

      await expect(svc.remove('u1', 'anime-slug')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('deve retornar lista paginada com filtro de status', async () => {
      const { svc, prisma } = build();
      const items = [{ id: 'l1', anime: { genres: [] } }];
      prisma.userAnimeList.findMany.mockResolvedValue(items);
      prisma.userAnimeList.count.mockResolvedValue(1);

      const result = await svc.list('u1', '1', '24', 'WATCHING');

      expect(result.data).toEqual(items);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 24,
        totalPages: 1,
      });
      expect(prisma.userAnimeList.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', status: 'WATCHING' },
          orderBy: { updatedAt: 'desc' },
        }),
      );
    });

    it('deve listar sem filtro de status quando não informado', async () => {
      const { svc, prisma } = build();
      prisma.userAnimeList.findMany.mockResolvedValue([]);
      prisma.userAnimeList.count.mockResolvedValue(0);

      await svc.list('u1', undefined, undefined);

      expect(prisma.userAnimeList.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });

    it('deve retornar lista vazia com totalPages = 0', async () => {
      const { svc, prisma } = build();
      prisma.userAnimeList.findMany.mockResolvedValue([]);
      prisma.userAnimeList.count.mockResolvedValue(0);

      const result = await svc.list('u1', undefined, undefined);

      expect(result.data).toEqual([]);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('getPublicList', () => {
    it('deve retornar apenas itens públicos', async () => {
      const { svc, prisma } = build();
      const items = [{ id: 'l1', anime: { genres: [] } }];
      prisma.userAnimeList.findMany.mockResolvedValue(items);
      prisma.userAnimeList.count.mockResolvedValue(1);

      const result = await svc.getPublicList('u1', 1, 24);

      expect(result.data).toEqual(items);
      expect(prisma.userAnimeList.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', private: false },
        }),
      );
    });

    it('deve retornar lista vazia quando não há itens públicos', async () => {
      const { svc, prisma } = build();
      prisma.userAnimeList.findMany.mockResolvedValue([]);
      prisma.userAnimeList.count.mockResolvedValue(0);

      const result = await svc.getPublicList('u1');

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('check', () => {
    it('deve retornar { inList: true } com status quando está na lista', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.userAnimeList.findUnique.mockResolvedValue({
        id: 'l1',
        status: WatchStatus.WATCHING,
      });

      const result = await svc.check('u1', 'anime-slug');

      expect(result).toEqual({ inList: true, status: WatchStatus.WATCHING });
    });

    it('deve retornar { inList: false } quando não está na lista', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.userAnimeList.findUnique.mockResolvedValue(null);

      const result = await svc.check('u1', 'anime-slug');

      expect(result).toEqual({ inList: false });
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.check('u1', 'nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
