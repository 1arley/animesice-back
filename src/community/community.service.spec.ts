import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CommunityService } from '@/community/community.service';
import { FeedbackStatus } from '@prisma/client';

function makePrisma() {
  const animeRequest = {
    findFirst: jest.fn(async () => null) as jest.Mock,
    create: jest.fn(async () => ({})) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const animeRequestVote = {
    findUnique: jest.fn(async () => null) as jest.Mock,
    delete: jest.fn(async () => ({})) as jest.Mock,
    create: jest.fn(async () => ({})) as jest.Mock,
  };
  const siteFeedback = {
    create: jest.fn(async () => ({})) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
  };
  const prisma = {
    animeRequest,
    animeRequestVote,
    siteFeedback,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

describe('CommunityService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new CommunityService(prisma as any);
    return { svc, prisma };
  }

  const userId = 'user-1';

  describe('createRequest', () => {
    it('deve criar solicitação com voto automático', async () => {
      const { svc, prisma } = build();
      prisma.animeRequest.create.mockResolvedValue({
        id: 'r1',
        user: { id: userId },
        _count: { votes: 1 },
      });
      const result = await svc.createRequest(userId, {
        title: 'Novo Anime',
        alternativeTitle: 'ALT',
        notes: 'notes',
      });
      expect(result).toHaveProperty('voteCount', 1);
      expect(result).toHaveProperty('hasVoted', true);
      expect(prisma.animeRequest.create).toHaveBeenCalled();
      expect(prisma.animeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { voteCount: 1 },
        }),
      );
    });

    it('deve lançar BadRequestException se título já solicitado', async () => {
      const { svc, prisma } = build();
      prisma.animeRequest.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        svc.createRequest(userId, { title: 'Existente' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listRequests', () => {
    it('deve listar solicitações com meta e filtro de status', async () => {
      const { svc, prisma } = build();
      prisma.animeRequest.findMany.mockResolvedValue([
        { id: 'r1', votes: [{ userId }] },
      ]);
      prisma.animeRequest.count.mockResolvedValue(1);
      const result = await svc.listRequests(1, 20, 'OPEN', userId);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty('hasVoted', true);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('deve marcar hasVoted false sem userId', async () => {
      const { svc, prisma } = build();
      prisma.animeRequest.findMany.mockResolvedValue([
        { id: 'r1', votes: [{ userId: 'x' }] },
      ]);
      prisma.animeRequest.count.mockResolvedValue(1);
      const result = await svc.listRequests(1, 20, undefined, undefined);
      expect(result.data[0]).toHaveProperty('hasVoted', false);
    });

    it('deve aplicar cap de limite em 100', async () => {
      const { svc, prisma } = build();
      await svc.listRequests(1, 999);
      expect(prisma.animeRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('voteRequest', () => {
    it('deve votar e incrementar contagem', async () => {
      const { svc, prisma } = build();
      prisma.animeRequest.findUnique.mockResolvedValue({
        id: 'r1',
        status: 'OPEN',
        voteCount: 5,
      });
      prisma.animeRequestVote.findUnique.mockResolvedValue(null);
      const result = await svc.voteRequest('r1', userId);
      expect(result).toEqual({ voted: true, voteCount: 6 });
      expect(prisma.animeRequestVote.create).toHaveBeenCalled();
      expect(prisma.animeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { voteCount: { increment: 1 } },
        }),
      );
    });

    it('deve remover voto existente e decrementar contagem', async () => {
      const { svc, prisma } = build();
      prisma.animeRequest.findUnique.mockResolvedValue({
        id: 'r1',
        status: 'OPEN',
        voteCount: 5,
      });
      prisma.animeRequestVote.findUnique.mockResolvedValue({
        requestId: 'r1',
        userId,
      });
      const result = await svc.voteRequest('r1', userId);
      expect(result).toEqual({ voted: false, voteCount: 4 });
      expect(prisma.animeRequestVote.delete).toHaveBeenCalled();
      expect(prisma.animeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { voteCount: { decrement: 1 } },
        }),
      );
    });

    it('deve lançar NotFoundException se solicitação não existir', async () => {
      const { svc } = build();
      await expect(svc.voteRequest('x', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('adminUpdateRequestStatus', () => {
    it('deve atualizar status da solicitação', async () => {
      const { svc, prisma } = build();
      prisma.animeRequest.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.animeRequest.update.mockResolvedValue({
        id: 'r1',
        status: FeedbackStatus.RESOLVED,
      });
      const result = await svc.adminUpdateRequestStatus(
        'r1',
        FeedbackStatus.RESOLVED,
        'nota',
      );
      expect(result).toHaveProperty('status', FeedbackStatus.RESOLVED);
      expect(prisma.animeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: FeedbackStatus.RESOLVED, adminNote: 'nota' },
        }),
      );
    });

    it('deve lançar NotFoundException se solicitação não existir', async () => {
      const { svc } = build();
      await expect(
        svc.adminUpdateRequestStatus('x', FeedbackStatus.RESOLVED),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createFeedback', () => {
    it('deve criar feedback', async () => {
      const { svc, prisma } = build();
      prisma.siteFeedback.create.mockResolvedValue({ id: 'f1' });
      const result = await svc.createFeedback(userId, {
        type: 'BUG',
        title: 'Erro',
        description: 'descrição',
      } as any);
      expect(result).toHaveProperty('id', 'f1');
      expect(prisma.siteFeedback.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId, title: 'Erro' }),
        }),
      );
    });
  });

  describe('listFeedback', () => {
    it('deve listar feedbacks com filtros e meta', async () => {
      const { svc, prisma } = build();
      prisma.siteFeedback.findMany.mockResolvedValue([{ id: 'f1' }]);
      prisma.siteFeedback.count.mockResolvedValue(3);
      const result = await svc.listFeedback(1, 20, 'BUG', 'OPEN');
      expect(result.data).toEqual([{ id: 'f1' }]);
      expect(result.meta.total).toBe(3);
      expect(prisma.siteFeedback.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { type: 'BUG', status: 'OPEN' } }),
      );
    });
  });

  describe('upvoteFeedback', () => {
    it('deve incrementar upvotes', async () => {
      const { svc, prisma } = build();
      prisma.siteFeedback.findUnique.mockResolvedValue({ id: 'f1' });
      prisma.siteFeedback.update.mockResolvedValue({ id: 'f1', upvotes: 1 });
      const result = await svc.upvoteFeedback('f1');
      expect(result).toHaveProperty('upvotes', 1);
      expect(prisma.siteFeedback.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { upvotes: { increment: 1 } },
        }),
      );
    });

    it('deve lançar NotFoundException se feedback não existir', async () => {
      const { svc } = build();
      await expect(svc.upvoteFeedback('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('adminUpdateFeedbackStatus', () => {
    it('deve atualizar status do feedback', async () => {
      const { svc, prisma } = build();
      prisma.siteFeedback.findUnique.mockResolvedValue({ id: 'f1' });
      prisma.siteFeedback.update.mockResolvedValue({
        id: 'f1',
        status: FeedbackStatus.COMPLETED,
      });
      const result = await svc.adminUpdateFeedbackStatus(
        'f1',
        FeedbackStatus.COMPLETED,
        'nota',
      );
      expect(result).toHaveProperty('status', FeedbackStatus.COMPLETED);
    });

    it('deve lançar NotFoundException se feedback não existir', async () => {
      const { svc } = build();
      await expect(
        svc.adminUpdateFeedbackStatus('x', FeedbackStatus.RESOLVED),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
