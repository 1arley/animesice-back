import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CommentService } from '@/comment/comment.service';

function makeNotificationService() {
  return {
    notifyCommentReply: jest.fn().mockResolvedValue(undefined),
    notifyCommentLike: jest.fn().mockResolvedValue(undefined),
  };
}

function makePrisma() {
  const comment = {
    findUnique: jest.fn(async () => null) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    create: jest.fn(async () => ({})) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
    delete: jest.fn(async () => ({})) as jest.Mock,
  };
  const anime = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const episode = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const user = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const commentLike = {
    findUnique: jest.fn(async () => null) as jest.Mock,
    create: jest.fn(async () => ({})) as jest.Mock,
    delete: jest.fn(async () => ({})) as jest.Mock,
  };
  const prisma = {
    comment,
    anime,
    episode,
    user,
    commentLike,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

describe('CommentService', () => {
  function build() {
    const prisma = makePrisma();
    const notificationService = makeNotificationService();
    const svc = new CommentService(prisma as any, notificationService as any);
    return { svc, prisma, notificationService };
  }

  const userId = 'user-1';

  describe('create', () => {
    it('deve criar comentário sem parentId', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.comment.create.mockResolvedValue({
        id: 'c1',
        content: 'test',
        user: {},
        _count: { likes: 0 },
      });
      const result = await svc.create(userId, {
        content: 'test',
        animeId: 'a1',
      });
      expect(result).toHaveProperty('id', 'c1');
      expect(prisma.comment.create).toHaveBeenCalled();
    });

    it('deve lançar NotFoundException se anime não existir', async () => {
      const { svc } = build();
      await expect(
        svc.create(userId, { content: 'test', animeId: 'inexistente' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException se episódio não existir', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      await expect(
        svc.create(userId, { content: 'test', episodeId: 'inexistente' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException se comentário pai não existir', async () => {
      const { svc } = build();
      await expect(
        svc.create(userId, { content: 'test', parentId: 'inexistente' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException se conteúdo vazio', async () => {
      const { svc } = build();
      await expect(svc.create(userId, { content: '   ' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve notificar reply quando parentId é fornecido', async () => {
      const { svc, prisma, notificationService } = build();
      prisma.comment.create.mockResolvedValue({
        id: 'c1',
        content: 'reply',
        user: {},
        _count: { likes: 0 },
      });
      prisma.comment.findUnique.mockResolvedValueOnce({ id: 'parent1' });
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' });
      prisma.comment.findUnique.mockResolvedValueOnce({
        id: 'parent1',
        animeId: 'a1',
      });
      prisma.anime.findUnique.mockResolvedValue({ slug: 'meu-anime' });
      await svc.create(userId, {
        content: 'reply',
        parentId: 'parent1',
        animeId: 'a1',
      });
      expect(notificationService.notifyCommentReply).toHaveBeenCalledWith(
        'parent1',
        'Alice',
        'meu-anime',
      );
    });

    it('deve sanitizar HTML do conteúdo', async () => {
      const { svc, prisma } = build();
      prisma.comment.create.mockResolvedValue({
        id: 'c1',
        content: 'test',
        user: {},
        _count: { likes: 0 },
      });
      await svc.create(userId, { content: '<b>bold</b> texto' });
      expect(prisma.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ content: 'bold texto' }),
        }),
      );
    });
  });

  describe('findByAnime', () => {
    it('deve listar comentários de um anime', async () => {
      const { svc, prisma } = build();
      await svc.findByAnime('a1', 1, 10);
      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { animeId: 'a1', parentId: null },
        }),
      );
    });
  });

  describe('findByEpisode', () => {
    it('deve listar comentários de um episódio', async () => {
      const { svc, prisma } = build();
      await svc.findByEpisode('e1', 1, 10);
      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { episodeId: 'e1', parentId: null },
        }),
      );
    });
  });

  describe('remove', () => {
    it('deve remover comentário do autor', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({ id: 'c1', userId });
      prisma.comment.delete.mockResolvedValue({ id: 'c1' });
      const result = await svc.remove(userId, 'c1');
      expect(result).toEqual({ id: 'c1' });
    });

    it('deve lançar NotFoundException se comentário não existir', async () => {
      const { svc } = build();
      await expect(svc.remove(userId, 'inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar ForbiddenException se não for o autor', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'outro',
      });
      await expect(svc.remove(userId, 'c1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('edit', () => {
    it('deve editar comentário do autor', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({ id: 'c1', userId });
      prisma.comment.update.mockResolvedValue({ id: 'c1', content: 'novo' });
      const result = await svc.edit(userId, 'c1', { content: 'novo' });
      expect(result).toHaveProperty('id', 'c1');
      expect(prisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ content: 'novo', edited: true }),
        }),
      );
    });

    it('deve lançar NotFoundException se não existir', async () => {
      const { svc } = build();
      await expect(svc.edit(userId, 'x', { content: 'a' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar ForbiddenException se não for o autor', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'outro',
      });
      await expect(svc.edit(userId, 'c1', { content: 'a' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('deve lançar BadRequestException se conteúdo vazio', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({ id: 'c1', userId });
      await expect(svc.edit(userId, 'c1', { content: '   ' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('toggleLike', () => {
    it('deve curtir comentário e notificar', async () => {
      const { svc, prisma, notificationService } = build();
      prisma.comment.findUnique.mockResolvedValueOnce({ id: 'c1' });
      prisma.commentLike.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ name: 'Liker' });
      prisma.comment.findUnique.mockResolvedValueOnce({
        id: 'c1',
        animeId: 'a1',
      });
      prisma.anime.findUnique.mockResolvedValue({ slug: 'anime-slug' });
      const result = await svc.toggleLike(userId, 'c1');
      expect(result).toEqual({ liked: true });
      expect(notificationService.notifyCommentLike).toHaveBeenCalled();
    });

    it('deve descurtir se já curtiu', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({ id: 'c1' });
      prisma.commentLike.findUnique.mockResolvedValue({
        userId,
        commentId: 'c1',
      });
      const result = await svc.toggleLike(userId, 'c1');
      expect(result).toEqual({ liked: false });
      expect(prisma.commentLike.delete).toHaveBeenCalled();
    });

    it('deve lançar NotFoundException se comentário não existir', async () => {
      const { svc } = build();
      await expect(svc.toggleLike(userId, 'inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findReplies', () => {
    it('deve retornar respostas com meta de paginação', async () => {
      const { svc, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({ id: 'parent' });
      const result = await svc.findReplies('parent', 1, 10);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
    });

    it('deve lançar NotFoundException se parent não existir', async () => {
      const { svc } = build();
      await expect(svc.findReplies('inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
