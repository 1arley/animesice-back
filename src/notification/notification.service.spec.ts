import { NotFoundException } from '@nestjs/common';
import { NotificationService } from '@/notification/notification.service';
import { NotificationType, NotificationChannel } from '@prisma/client';

function makePrisma() {
  const notification = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
    updateMany: jest.fn(async () => ({})) as jest.Mock,
    create: jest.fn(async () => ({})) as jest.Mock,
    createMany: jest.fn(async () => ({})) as jest.Mock,
  };
  const notificationPreference = {
    count: jest.fn(async () => 1) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    upsert: jest.fn(async () => ({})) as jest.Mock,
    createMany: jest.fn(async () => ({})) as jest.Mock,
  };
  const userAnimeList = {
    findMany: jest.fn(async () => []) as jest.Mock,
  };
  const comment = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const prisma = {
    notification,
    notificationPreference,
    userAnimeList,
    comment,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

describe('NotificationService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new NotificationService(prisma as any);
    return { svc, prisma };
  }

  const userId = 'user-1';

  describe('list', () => {
    it('deve listar notificações com meta e unreadCount', async () => {
      const { svc, prisma } = build();
      prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
      prisma.notification.count.mockResolvedValue(10);
      prisma.notificationPreference.count.mockResolvedValue(1);
      const result = await svc.list(userId, 1, 20, false);
      expect(result.data).toEqual([{ id: 'n1' }]);
      expect(result.unreadCount).toBe(10);
      expect(result.meta.total).toBe(10);
      expect(prisma.notificationPreference.createMany).not.toHaveBeenCalled();
    });

    it('deve aplicar filtro unreadOnly', async () => {
      const { svc, prisma } = build();
      prisma.notificationPreference.count.mockResolvedValue(1);
      await svc.list(userId, 1, 20, true);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId, read: false } }),
      );
    });

    it('deve semear preferências padrão quando não existirem', async () => {
      const { svc, prisma } = build();
      prisma.notificationPreference.count.mockResolvedValue(0);
      await svc.list(userId, 1, 20, false);
      expect(prisma.notificationPreference.createMany).toHaveBeenCalled();
    });

    it('deve aplicar cap de limite em 100', async () => {
      const { svc, prisma } = build();
      await svc.list(userId, 1, 999);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('markAsRead', () => {
    it('deve marcar notificação como lida', async () => {
      const { svc, prisma } = build();
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId });
      prisma.notification.update.mockResolvedValue({ id: 'n1', read: true });
      const result = await svc.markAsRead(userId, 'n1');
      expect(result).toHaveProperty('read', true);
    });

    it('deve lançar NotFoundException se notificação não existir', async () => {
      const { svc } = build();
      await expect(svc.markAsRead(userId, 'x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar NotFoundException se notificação for de outro usuário', async () => {
      const { svc, prisma } = build();
      prisma.notification.findUnique.mockResolvedValue({
        id: 'n1',
        userId: 'outro',
      });
      await expect(svc.markAsRead(userId, 'n1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('deve marcar todas como lidas e retornar mensagem', async () => {
      const { svc, prisma } = build();
      const result = await svc.markAllAsRead(userId);
      expect(result).toEqual({
        message: 'Todas as notificações marcadas como lidas.',
      });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, read: false },
        data: { read: true },
      });
    });
  });

  describe('create', () => {
    it('deve criar notificação quando preferência habilitada', async () => {
      const { svc, prisma } = build();
      prisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: true,
      });
      prisma.notification.create.mockResolvedValue({ id: 'n1' });
      const result = await svc.create({
        userId,
        type: NotificationType.SYSTEM,
        title: 'Título',
        body: 'Corpo',
        linkUrl: '/x',
      });
      expect(result).toEqual({ id: 'n1' });
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId, title: 'Título' }),
        }),
      );
    });

    it('deve retornar null quando preferência desabilitada', async () => {
      const { svc, prisma } = build();
      prisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: false,
      });
      const result = await svc.create({
        userId,
        type: NotificationType.SYSTEM,
        title: 'T',
      });
      expect(result).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('deve assumir habilitado e semear quando não houver preferência', async () => {
      const { svc, prisma } = build();
      prisma.notification.create.mockResolvedValue({ id: 'n1' });
      const result = await svc.create({
        userId,
        type: NotificationType.SYSTEM,
        title: 'T',
      });
      expect(result).toEqual({ id: 'n1' });
      expect(prisma.notificationPreference.createMany).toHaveBeenCalled();
    });
  });

  describe('notifyNewEpisode', () => {
    it('deve retornar count 0 sem espectadores', async () => {
      const { svc } = build();
      const result = await svc.notifyNewEpisode('a1', 'Anime', 1, 'slug');
      expect(result).toEqual({ count: 0 });
    });

    it('deve filtrar espectadores com preferência desabilitada', async () => {
      const { svc, prisma } = build();
      prisma.userAnimeList.findMany.mockResolvedValue([
        {
          userId: 'u1',
          user: { notificationPreferences: [{ enabled: false }] },
        },
        {
          userId: 'u2',
          user: { notificationPreferences: [{ enabled: true }] },
        },
        {
          userId: 'u3',
          user: { notificationPreferences: [] },
        },
      ]);
      prisma.notification.createMany.mockResolvedValue({ count: 2 });
      const result = await svc.notifyNewEpisode('a1', 'Anime', 1, 'slug');
      expect(result).toEqual({ count: 2 });
      const arg = prisma.notification.createMany.mock.calls[0][0];
      expect(arg.data.map((n: { userId: string }) => n.userId)).toEqual([
        'u2',
        'u3',
      ]);
      expect(arg.data[0].linkUrl).toBe('/animes/slug/1');
    });
  });

  describe('notifyCommentReply', () => {
    it('deve retornar null se parent não existir', async () => {
      const { svc } = build();
      expect(await svc.notifyCommentReply('x', 'Alice')).toBeNull();
    });

    it('deve retornar null se parent for de autor anônimo', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({
        userId: null,
        animeId: null,
        episodeId: null,
      });
      expect(await svc.notifyCommentReply('x', 'Alice')).toBeNull();
    });

    it('deve criar notificação com link do anime', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({
        userId: 'owner',
        animeId: 'a1',
        episodeId: null,
      });
      prisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: true,
      });
      prisma.notification.create.mockResolvedValue({ id: 'n1' });
      const result = await svc.notifyCommentReply('x', 'Alice', 'anime-slug');
      expect(result).toEqual({ id: 'n1' });
      const arg = prisma.notification.create.mock.calls[0][0];
      expect(arg.data.userId).toBe('owner');
      expect(arg.data.linkUrl).toBe('/animes/anime-slug');
    });

    it('deve usar link raiz quando animeSlug ausente', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({
        userId: 'owner',
        animeId: 'a1',
        episodeId: null,
      });
      prisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: true,
      });
      prisma.notification.create.mockResolvedValue({ id: 'n1' });
      await svc.notifyCommentReply('x', 'Alice');
      const arg = prisma.notification.create.mock.calls[0][0];
      expect(arg.data.linkUrl).toBe('/');
    });
  });

  describe('notifyCommentLike', () => {
    it('deve retornar null se comentário não existir', async () => {
      const { svc } = build();
      expect(await svc.notifyCommentLike('x', 'Liker')).toBeNull();
    });

    it('deve retornar null se autor for anônimo', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({ userId: null });
      expect(await svc.notifyCommentLike('x', 'Liker')).toBeNull();
    });

    it('deve criar notificação de like', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({ userId: 'owner' });
      prisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: true,
      });
      prisma.notification.create.mockResolvedValue({ id: 'n1' });
      const result = await svc.notifyCommentLike('x', 'Liker', 'slug');
      expect(result).toEqual({ id: 'n1' });
      const arg = prisma.notification.create.mock.calls[0][0];
      expect(arg.data.userId).toBe('owner');
      expect(arg.data.linkUrl).toBe('/animes/slug');
      expect(arg.data.type).toBe(NotificationType.COMMENT_LIKE);
    });
  });

  describe('getPreferences', () => {
    it('deve retornar preferências existentes', async () => {
      const { svc, prisma } = build();
      prisma.notificationPreference.findMany.mockResolvedValue([{ id: 'p1' }]);
      const result = await svc.getPreferences(userId);
      expect(result).toEqual([{ id: 'p1' }]);
    });

    it('deve semear e buscar novamente quando não existirem', async () => {
      const { svc, prisma } = build();
      prisma.notificationPreference.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'p1' }]);
      const result = await svc.getPreferences(userId);
      expect(result).toEqual([{ id: 'p1' }]);
      expect(prisma.notificationPreference.createMany).toHaveBeenCalled();
    });
  });

  describe('updatePreference', () => {
    it('deve fazer upsert da preferência', async () => {
      const { svc, prisma } = build();
      prisma.notificationPreference.upsert.mockResolvedValue({
        id: 'p1',
        enabled: false,
      });
      const result = await svc.updatePreference(
        userId,
        NotificationType.SYSTEM,
        NotificationChannel.IN_APP,
        false,
      );
      expect(result).toEqual({ id: 'p1', enabled: false });
      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_typeId_channel: {
              userId,
              typeId: NotificationType.SYSTEM,
              channel: NotificationChannel.IN_APP,
            },
          },
        }),
      );
    });
  });
});
