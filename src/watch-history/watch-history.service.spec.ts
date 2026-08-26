import { NotFoundException } from '@nestjs/common';
import { WatchHistoryService } from '@/watch-history/watch-history.service';
import { UpdateProgressDto } from '@/watch-history/dto/update-progress.dto';

function makePrisma() {
  const anime = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const episode = {
    findFirst: jest.fn(async () => null) as jest.Mock,
  };
  const watchHistory = {
    upsert: jest.fn(async () => ({})) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    deleteMany: jest.fn(async () => ({ count: 0 })) as jest.Mock,
  };
  return {
    anime,
    episode,
    watchHistory,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('WatchHistoryService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new WatchHistoryService(prisma as any);
    return { svc, prisma };
  }

  describe('updateProgress', () => {
    const dto: UpdateProgressDto = { progress: 100, duration: 120 };

    it('deve criar o histórico quando não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 120 });
      prisma.watchHistory.upsert.mockResolvedValue({ id: 'wh1' });

      const result = await svc.updateProgress('u1', 'anime-slug', 1, dto);

      expect(result).toEqual({ id: 'wh1' });
      const args = prisma.watchHistory.upsert.mock.calls[0][0];
      expect(args.where).toEqual({
        userId_episodeId: { userId: 'u1', episodeId: 'e1' },
      });
      expect(args.create).toEqual(
        expect.objectContaining({
          userId: 'u1',
          episodeId: 'e1',
          progress: 100,
          duration: 120,
          completed: false,
        }),
      );
    });

    it('deve marcar como completado quando progress/duration >= 0.9', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 100 });
      prisma.watchHistory.upsert.mockResolvedValue({ id: 'wh1' });

      await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 90,
        duration: 100,
      });

      const args = prisma.watchHistory.upsert.mock.calls[0][0];
      expect(args.create.completed).toBe(true);
    });

    it('deve respeitar dto.completed explícito', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 100 });
      prisma.watchHistory.upsert.mockResolvedValue({ id: 'wh1' });

      await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 10,
        duration: 100,
        completed: true,
      });

      const args = prisma.watchHistory.upsert.mock.calls[0][0];
      expect(args.create.completed).toBe(true);
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(
        svc.updateProgress('u1', 'nao-existe', 1, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException quando o episódio não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });

      await expect(
        svc.updateProgress('u1', 'anime-slug', 999, dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getContinueWatching', () => {
    it('deve retornar itens em andamento mapeados', async () => {
      const { svc, prisma } = build();
      const histories = [
        {
          episodeId: 'e1',
          progress: 50,
          duration: 120,
          watchedAt: new Date(),
          completed: false,
          episode: {
            id: 'e1',
            number: 1,
            title: 'Episódio 1',
            thumbnailUrl: 'thumb.jpg',
            duration: 120,
            anime: { id: 'a1', title: 'Anime 1', genres: [] },
          },
        },
      ];
      prisma.watchHistory.findMany.mockResolvedValue(histories);

      const result = await svc.getContinueWatching('u1', 12);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          episodeId: 'e1',
          progress: 50,
          episode: expect.objectContaining({ id: 'e1', number: 1 }),
          anime: expect.objectContaining({ id: 'a1' }),
        }),
      );
    });

    it('deve retornar lista vazia quando não há histórico', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);

      const result = await svc.getContinueWatching('u1');

      expect(result).toEqual([]);
    });

    it('deve limitar limit ao máximo 50 e mínimo 1', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);

      await svc.getContinueWatching('u1', 999);
      expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );

      await svc.getContinueWatching('u1', 0);
      expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });

    it('deve filtrar apenas itens não completados', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);

      await svc.getContinueWatching('u1');

      expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', completed: false },
          orderBy: { watchedAt: 'desc' },
        }),
      );
    });
  });

  describe('getHistory', () => {
    it('deve retornar histórico paginado', async () => {
      const { svc, prisma } = build();
      const histories = [
        {
          episodeId: 'e1',
          progress: 100,
          completed: true,
          watchedAt: new Date(),
          episode: {
            id: 'e1',
            number: 1,
            title: 'Episódio 1',
            anime: { id: 'a1', slug: 'anime-slug', title: 'Anime 1' },
          },
        },
      ];
      prisma.watchHistory.findMany.mockResolvedValue(histories);
      prisma.watchHistory.count.mockResolvedValue(1);

      const result = await svc.getHistory('u1', 1, 24);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 24,
        totalPages: 1,
      });
    });

    it('deve retornar meta com totalPages = 0 sem histórico', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);
      prisma.watchHistory.count.mockResolvedValue(0);

      const result = await svc.getHistory('u1');

      expect(result.data).toEqual([]);
      expect(result.meta.totalPages).toBe(0);
    });

    it('deve limitar page ao mínimo 1 e limit ao máximo 100', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);
      prisma.watchHistory.count.mockResolvedValue(0);

      await svc.getHistory('u1', 0, 999);

      expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });
  });

  describe('deleteHistory', () => {
    it('deve remover o item do histórico', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 120 });
      prisma.watchHistory.deleteMany.mockResolvedValue({ count: 1 });

      const result = await svc.deleteHistory('u1', 'anime-slug', 1);

      expect(result).toEqual({ message: 'Removido do histórico.' });
      expect(prisma.watchHistory.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', episodeId: 'e1' },
      });
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.deleteHistory('u1', 'nao-existe', 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar NotFoundException quando o episódio não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });

      await expect(svc.deleteHistory('u1', 'anime-slug', 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
