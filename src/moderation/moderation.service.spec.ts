import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ModerationService } from '@/moderation/moderation.service';
import { ReportStatus, ContentStatus, NotificationType } from '@prisma/client';

function makeNotificationService() {
  return { create: jest.fn().mockResolvedValue({}) };
}

function makePrisma() {
  const report = {
    create: jest.fn(async () => ({})) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
  };
  const user = {
    findUnique: jest.fn(async () => null) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
  };
  const moderationAction = {
    create: jest.fn(async () => ({})) as jest.Mock,
  };
  const comment = {
    findUnique: jest.fn(async () => null) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
  };
  const post = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
    delete: jest.fn(async () => ({})) as jest.Mock,
  };
  const roomMessage = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const anime = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const postComment = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const prisma = {
    report,
    user,
    moderationAction,
    comment,
    post,
    roomMessage,
    anime,
    postComment,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

describe('ModerationService', () => {
  function build() {
    const prisma = makePrisma();
    const notificationService = makeNotificationService();
    const svc = new ModerationService(
      prisma as any,
      notificationService as any,
    );
    return { svc, prisma, notificationService };
  }

  describe('createReport', () => {
    it.each([
      'COMMENT',
      'ROOM_MESSAGE',
      'USER',
      'ANIME',
      'POST',
      'POST_COMMENT',
    ] as const)('deve criar denúncia para alvo %s', async (targetType) => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({ id: 't1' });
      prisma.roomMessage.findUnique.mockResolvedValue({ id: 't1' });
      prisma.user.findUnique.mockResolvedValue({ id: 't1' });
      prisma.anime.findUnique.mockResolvedValue({ id: 't1' });
      prisma.post.findUnique.mockResolvedValue({ id: 't1' });
      prisma.postComment.findUnique.mockResolvedValue({ id: 't1' });
      prisma.report.create.mockResolvedValue({ id: 'r1' });
      const result = await svc.createReport('user-1', {
        targetType,
        targetId: 't1',
        reason: 'SPAM',
        notes: 'note',
      } as any);
      expect(result).toEqual({ id: 'r1' });
      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reporterId: 'user-1',
            targetType,
            targetId: 't1',
          }),
        }),
      );
    });

    it('deve lançar BadRequestException se alvo não existir', async () => {
      const { svc } = build();
      await expect(
        svc.createReport('user-1', {
          targetType: 'COMMENT',
          targetId: 'x',
          reason: 'SPAM',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listReports', () => {
    it('deve listar denúncias com meta de paginação e filtro de status', async () => {
      const { svc, prisma } = build();
      prisma.report.findMany.mockResolvedValue([{ id: 'r1' }]);
      prisma.report.count.mockResolvedValue(5);
      const result = await svc.listReports(1, 2, 'PENDING');
      expect(result.data).toEqual([{ id: 'r1' }]);
      expect(result.meta).toEqual({
        total: 5,
        page: 1,
        limit: 2,
        totalPages: 3,
      });
      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } }),
      );
    });

    it('deve aplicar cap de limite em 100', async () => {
      const { svc, prisma } = build();
      await svc.listReports(1, 999);
      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('resolveReport', () => {
    it('deve resolver denúncia', async () => {
      const { svc, prisma } = build();
      prisma.report.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.report.update.mockResolvedValue({
        id: 'r1',
        status: ReportStatus.RESOLVED,
      });
      const result = await svc.resolveReport(
        'r1',
        'mod-1',
        ReportStatus.RESOLVED,
        { moderationNote: 'ok' },
      );
      expect(result).toHaveProperty('status', ReportStatus.RESOLVED);
      expect(prisma.report.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReportStatus.RESOLVED,
            moderatorId: 'mod-1',
            moderationNote: 'ok',
          }),
        }),
      );
    });

    it('deve lançar NotFoundException se denúncia não existir', async () => {
      const { svc } = build();
      await expect(
        svc.resolveReport('x', 'mod-1', ReportStatus.RESOLVED, {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('moderateUser', () => {
    it('deve aplicar WARN sem suspender o usuário', async () => {
      const { svc, prisma, notificationService } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'target',
        name: 'T',
        userName: 't',
      });
      prisma.moderationAction.create.mockResolvedValue({
        id: 'a1',
        actionType: 'WARN',
      });
      const result = await svc.moderateUser('target', 'mod-1', {
        actionType: 'WARN',
        reason: 'aviso',
      } as any);
      expect(result).toEqual({ id: 'a1', actionType: 'WARN' });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'target',
          type: NotificationType.MODERATION_ACTION,
        }),
      );
    });

    it('deve aplicar MUTE suspendendo o usuário', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'target',
        name: 'T',
        userName: 't',
      });
      prisma.moderationAction.create.mockResolvedValue({
        id: 'a1',
        actionType: 'MUTE',
      });
      prisma.user.update.mockResolvedValue({ id: 'target' });
      await svc.moderateUser('target', 'mod-1', {
        actionType: 'MUTE',
        reason: 'spam',
      } as any);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'target' },
          data: expect.objectContaining({
            suspendedReason: 'spam',
            suspendedUntil: null,
          }),
        }),
      );
    });

    it('deve calcular expiresAt quando hours é informado', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'target',
        name: 'T',
        userName: 't',
      });
      prisma.moderationAction.create.mockResolvedValue({
        id: 'a1',
        actionType: 'BAN',
      });
      prisma.user.update.mockResolvedValue({ id: 'target' });
      await svc.moderateUser('target', 'mod-1', {
        actionType: 'BAN',
        reason: 'spam',
        hours: 24,
      } as any);
      const data = prisma.moderationAction.create.mock.calls[0][0].data;
      expect(data.expiresAt).toBeInstanceOf(Date);
    });

    it('deve lançar NotFoundException se usuário não existir', async () => {
      const { svc } = build();
      await expect(
        svc.moderateUser('x', 'mod-1', { actionType: 'WARN' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteComment', () => {
    it('deve ocultar comentário do mod', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({
        id: 'c1',
        status: 'VISIBLE',
      });
      prisma.comment.update.mockResolvedValue({
        id: 'c1',
        status: ContentStatus.HIDDEN_BY_MOD,
      });
      const result = await svc.deleteComment('c1', 'mod-1');
      expect(result).toHaveProperty('status', ContentStatus.HIDDEN_BY_MOD);
    });

    it('deve lançar NotFoundException se comentário não existir', async () => {
      const { svc } = build();
      await expect(svc.deleteComment('x', 'mod-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('adminListPosts', () => {
    it('deve listar posts com filtro de status e meta', async () => {
      const { svc, prisma } = build();
      prisma.post.findMany.mockResolvedValue([{ id: 'p1' }]);
      prisma.post.count.mockResolvedValue(1);
      const result = await svc.adminListPosts(1, 20, 'HIDDEN_BY_MOD');
      expect(result.data).toEqual([{ id: 'p1' }]);
      expect(result.meta.total).toBe(1);
      expect(prisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'HIDDEN_BY_MOD' } }),
      );
    });
  });

  describe('adminHidePost', () => {
    it('deve ocultar post', async () => {
      const { svc, prisma } = build();
      prisma.post.findUnique.mockResolvedValue({ id: 'p1', status: 'VISIBLE' });
      prisma.post.update.mockResolvedValue({
        id: 'p1',
        status: ContentStatus.HIDDEN_BY_MOD,
      });
      const result = await svc.adminHidePost('p1');
      expect(result).toHaveProperty('status', ContentStatus.HIDDEN_BY_MOD);
    });

    it('deve lançar NotFoundException se post não existir', async () => {
      const { svc } = build();
      await expect(svc.adminHidePost('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('adminDeletePost', () => {
    it('deve excluir post permanentemente', async () => {
      const { svc, prisma } = build();
      prisma.post.findUnique.mockResolvedValue({ id: 'p1' });
      const result = await svc.adminDeletePost('p1');
      expect(result).toEqual({ message: 'Post removido permanentemente.' });
      expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });

    it('deve lançar NotFoundException se post não existir', async () => {
      const { svc } = build();
      await expect(svc.adminDeletePost('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('isUserSuspended', () => {
    it('deve retornar false se usuário não existir', async () => {
      const { svc } = build();
      expect(await svc.isUserSuspended('x')).toBe(false);
    });

    it('deve retornar false se não houver suspensão', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({ suspendedUntil: null });
      expect(await svc.isUserSuspended('x')).toBe(false);
    });

    it('deve retornar false se suspensão expirou', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        suspendedUntil: new Date(Date.now() - 1000),
      });
      expect(await svc.isUserSuspended('x')).toBe(false);
    });

    it('deve retornar true se suspensão vigente', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        suspendedUntil: new Date(Date.now() + 100000),
      });
      expect(await svc.isUserSuspended('x')).toBe(true);
    });
  });
});
