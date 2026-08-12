import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SocialService } from '@/social/social.service';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';

describe('SocialService', () => {
  let service: SocialService;
  let prisma: PrismaService;

  const mockNotifications = {
    create: jest.fn().mockResolvedValue({}),
  };

  const mockPrisma = {
    post: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    postLike: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    postComment: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    follow: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    anime: { findUnique: jest.fn() },
    watchHistory: { findMany: jest.fn(), count: jest.fn() },
    rating: { findMany: jest.fn(), count: jest.fn() },
    favorite: { findMany: jest.fn(), count: jest.fn() },
    comment: { findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    // resetAllMocks (e não clearAllMocks) limpa também as filas de
    // mockResolvedValueOnce — evita vazamento de valores entre testes.
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<SocialService>(SocialService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  // ------------------------------------------------------------------
  // Posts
  // ------------------------------------------------------------------

  describe('createPost', () => {
    it('cria post sem anime', async () => {
      mockPrisma.post.create.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        content: 'oi',
      });

      await service.createPost('u1', { content: '  oi  ' });

      expect(prisma.post.create).toHaveBeenCalledWith({
        data: { userId: 'u1', content: 'oi', animeId: null },
        select: expect.anything(),
      });
    });

    it('rejeita conteúdo vazio (após trim)', async () => {
      await expect(
        service.createPost('u1', { content: '   ' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.post.create).not.toHaveBeenCalled();
    });

    it('rejeita animeId inexistente', async () => {
      mockPrisma.anime.findUnique.mockResolvedValue(null);

      await expect(
        service.createPost('u1', { content: 'oi', animeId: 'a-inexistente' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.post.create).not.toHaveBeenCalled();
    });
  });

  describe('deletePost', () => {
    it('só o dono pode excluir', async () => {
      mockPrisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
      });

      await expect(service.deletePost('u2', 'p1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.post.delete).not.toHaveBeenCalled();
    });

    it('dono exclui com sucesso', async () => {
      mockPrisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
      });
      mockPrisma.post.delete.mockResolvedValue({});

      const result = await service.deletePost('u1', 'p1');

      expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
      expect(result).toEqual({ message: 'Post removido.' });
    });

    it('post inexistente → NotFound', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(null);
      await expect(service.deletePost('u1', 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('togglePostLike', () => {
    it('curte e notifica o autor (quando não é o próprio)', async () => {
      mockPrisma.post.findFirst.mockResolvedValue({
        id: 'p1',
        userId: 'owner',
        content: 'Post legal',
      });
      mockPrisma.postLike.findUnique.mockResolvedValue(null);
      mockPrisma.postLike.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Fã' });

      const result = await service.togglePostLike('fan', 'p1');

      expect(result).toEqual({ liked: true });
      expect(prisma.postLike.create).toHaveBeenCalledWith({
        data: { userId: 'fan', postId: 'p1' },
      });
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner',
          type: 'POST_LIKE',
          title: 'Fã curtiu seu post',
        }),
      );
    });

    it('descurte e NÃO notifica', async () => {
      mockPrisma.post.findFirst.mockResolvedValue({
        id: 'p1',
        userId: 'owner',
        content: 'x',
      });
      mockPrisma.postLike.findUnique.mockResolvedValue({
        createdAt: new Date(),
      });
      mockPrisma.postLike.delete.mockResolvedValue({});

      const result = await service.togglePostLike('fan', 'p1');

      expect(result).toEqual({ liked: false });
      expect(prisma.postLike.delete).toHaveBeenCalled();
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it('curtir o próprio post não gera notificação', async () => {
      mockPrisma.post.findFirst.mockResolvedValue({
        id: 'p1',
        userId: 'me',
        content: 'x',
      });
      mockPrisma.postLike.findUnique.mockResolvedValue(null);
      mockPrisma.postLike.create.mockResolvedValue({});

      await service.togglePostLike('me', 'p1');

      expect(mockNotifications.create).not.toHaveBeenCalled();
    });
  });

  describe('createPostComment', () => {
    it('comenta e notifica o autor do post', async () => {
      mockPrisma.post.findFirst.mockResolvedValue({
        id: 'p1',
        userId: 'owner',
        content: 'x',
      });
      mockPrisma.postComment.create.mockResolvedValue({ id: 'c1' });
      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Comentarista' });

      await service.createPostComment('fan', 'p1', { content: 'concordo' });

      expect(prisma.postComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { postId: 'p1', userId: 'fan', content: 'concordo' },
        }),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner',
          type: 'POST_COMMENT',
        }),
      );
    });

    it('comentário vazio (após trim) → BadRequest', async () => {
      mockPrisma.post.findFirst.mockResolvedValue({ id: 'p1' });

      await expect(
        service.createPostComment('u1', 'p1', { content: '   ' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.postComment.create).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Follow
  // ------------------------------------------------------------------

  describe('toggleFollow', () => {
    it('impede seguir a si mesmo', async () => {
      await expect(service.toggleFollow('u1', 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('target inexistente → NotFound', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.toggleFollow('u1', 'u2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('segue e notifica o seguido', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'u2',
        userName: 'bruno',
      });
      mockPrisma.follow.findUnique.mockResolvedValue(null);
      mockPrisma.follow.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        name: 'Ana',
        userName: 'ana',
      });

      const result = await service.toggleFollow('u1', 'u2');

      expect(result).toEqual({ following: true });
      expect(prisma.follow.create).toHaveBeenCalledWith({
        data: { followerId: 'u1', followeeId: 'u2' },
      });
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u2',
          type: 'NEW_FOLLOW',
          title: 'Ana começou a seguir você',
        }),
      );
    });

    it('deixa de seguir (sem notificação)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u2' });
      mockPrisma.follow.findUnique.mockResolvedValue({
        createdAt: new Date(),
      });
      mockPrisma.follow.delete.mockResolvedValue({});

      const result = await service.toggleFollow('u1', 'u2');

      expect(result).toEqual({ following: false });
      expect(prisma.follow.delete).toHaveBeenCalled();
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });
  });

  describe('getFollowers / getFollowingForUser (listas públicas)', () => {
    const publicUser = (id: string, name: string) => ({
      id,
      name,
      userName: name.toLowerCase(),
      avatar: null,
      bio: null,
      createdAt: new Date(),
      _count: { comments: 1, ratings: 1, favorites: 1 },
    });

    it('target privado → NotFound (mesma regra de /users/:id)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getFollowers('privado', null)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.getFollowingForUser('privado', null),
      ).rejects.toThrow(NotFoundException);
      // Nenhuma query de follow roda para alvo inexistente/privado.
      expect(prisma.follow.findMany).not.toHaveBeenCalled();
    });

    it('exclui perfis privados da lista e do count (findMany + count)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      // u2 é público; u3 teria sido filtrado pelo where (não aparece).
      mockPrisma.$transaction.mockResolvedValue([
        [
          { follower: publicUser('u2', 'Bruno') },
          { follower: publicUser('u4', 'Davi') },
        ],
        2,
      ]);

      const result = await service.getFollowers('u1', null);

      // Ambos usam o filtro de perfil público na relação listada.
      const followFilter = {
        OR: [
          { privacySettings: null },
          { privacySettings: { profilePublic: true } },
        ],
      };
      expect(prisma.follow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            followeeId: 'u1',
            follower: followFilter,
          }),
        }),
      );
      expect(prisma.follow.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            followeeId: 'u1',
            follower: followFilter,
          }),
        }),
      );

      // Sem viewer logado → isFollowing false em todos.
      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.data.every((u) => u.isFollowing === false)).toBe(true);
    });

    it('getFollowingForUser usa o filtro na relação followee', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      mockPrisma.$transaction.mockResolvedValue([
        [{ followee: publicUser('u2', 'Bruno') }],
        1,
      ]);

      const result = await service.getFollowingForUser('u1', null);

      expect(prisma.follow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            followerId: 'u1',
            followee: expect.objectContaining({
              OR: expect.any(Array),
            }),
          }),
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe('u2');
    });

    it('marca isFollowing do viewer logado nas duas listas', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      mockPrisma.$transaction.mockResolvedValue([
        [
          { follower: publicUser('u2', 'Bruno') },
          { follower: publicUser('u4', 'Davi') },
        ],
        2,
      ]);
      // Viewer 'me' já segue u2 (não u4).
      mockPrisma.follow.findMany.mockResolvedValue([{ followeeId: 'u2' }]);

      const result = await service.getFollowers('u1', 'me');

      expect(prisma.follow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            followerId: 'me',
            followeeId: { in: ['u2', 'u4'] },
          },
        }),
      );
      const byId = new Map(result.data.map((u) => [u.id, u]));
      expect(byId.get('u2')!.isFollowing).toBe(true);
      expect(byId.get('u4')!.isFollowing).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // Feed
  // ------------------------------------------------------------------

  describe('getFeed (merge posts + atividade)', () => {
    const now = new Date();
    const older = new Date(now.getTime() - 2 * 3600e3);

    const postP1 = {
      id: 'p1',
      content: 'Post da Ana',
      animeId: null,
      shareCount: 1,
      status: 'VISIBLE',
      createdAt: older,
      updatedAt: older,
      anime: null,
      user: { id: 'u1', name: 'Ana', userName: 'ana', avatar: null },
      _count: { likes: 1, comments: 2 },
    };
    const postP2 = {
      id: 'p2',
      content: 'Post do Bruno',
      animeId: null,
      shareCount: 0,
      status: 'VISIBLE',
      createdAt: now,
      updatedAt: now,
      anime: null,
      user: { id: 'u2', name: 'Bruno', userName: 'bruno', avatar: null },
      _count: { likes: 0, comments: 0 },
    };
    // Evento mais novo que os posts — garante posição no merge.
    const ratingCreatedAt = new Date(now.getTime() + 3600e3);

    beforeEach(() => {
      // Ordem das chamadas $queryRaw: [publicIds, showActivity, showRatings, showFavorites]
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
        .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
        .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
        .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]);
    });

    it('mescla posts e atividade ordenados por data desc, com autor no evento', async () => {
      mockPrisma.post.findMany.mockResolvedValue([postP1, postP2]);
      mockPrisma.post.count.mockResolvedValue(2);
      mockPrisma.$transaction.mockResolvedValue([
        [], // watches
        [
          {
            userId: 'u1',
            score: 9,
            createdAt: ratingCreatedAt,
            anime: { slug: 'frieren', title: 'Frieren', coverImage: null },
          },
        ], // ratings
        [], // favorites
        [], // comments
        0, // watchCount
        1, // ratingCount
        0, // favCount
        0, // commentCount
      ]);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', name: 'Ana', userName: 'ana', avatar: null },
      ]);

      const result = await service.getFeed(null, 1, 20, 'global');

      expect(result.meta.total).toBe(3);
      expect(result.data).toHaveLength(3);

      // 1º: evento de atividade (mais recente), com autor resolvido
      const first = result.data[0]!;
      expect(first.type).toBe('activity');
      if (first.type === 'activity') {
        expect(first.event.type).toBe('rating');
        expect(first.event.score).toBe(9);
        expect(first.user?.name).toBe('Ana');
      }

      // 2º e 3º: posts
      const second = result.data[1]!;
      expect(second.type).toBe('post');
      if (second.type === 'post') {
        expect(second.post.id).toBe('p2');
        expect(second.post.hasLiked).toBe(false);
      }

      const third = result.data[2]!;
      expect(third.type).toBe('post');
      if (third.type === 'post') {
        expect(third.post.id).toBe('p1');
      }
    });

    it('limita o feed e informa paginação correta', async () => {
      const manyPosts = Array.from({ length: 25 }, (_, i) => ({
        ...postP1,
        id: 'p' + (i + 1),
        createdAt: new Date(now.getTime() - i * 60000),
      }));
      mockPrisma.post.findMany.mockResolvedValue(manyPosts.slice(0, 20));
      mockPrisma.post.count.mockResolvedValue(25);
      mockPrisma.$transaction.mockResolvedValue([[], [], [], [], 0, 0, 0, 0]);

      const result = await service.getFeed(null, 1, 20, 'global');

      expect(result.data).toHaveLength(20);
      expect(result.meta.totalPages).toBe(2);
    });

    it('passa skip correto na página 2', async () => {
      mockPrisma.post.findMany.mockResolvedValue([]);
      mockPrisma.post.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockResolvedValue([[], [], [], [], 0, 0, 0, 0]);

      await service.getFeed(null, 2, 20, 'global');

      expect(prisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });

    it('marca hasLiked para o viewer logado', async () => {
      mockPrisma.post.findMany.mockResolvedValue([postP1, postP2]);
      mockPrisma.post.count.mockResolvedValue(2);
      mockPrisma.$transaction.mockResolvedValue([[], [], [], [], 0, 0, 0, 0]);
      // Viewer 'me' curtiu p1.
      mockPrisma.postLike.findMany.mockResolvedValue([{ postId: 'p1' }]);

      const result = await service.getFeed('me', 1, 20, 'global');

      expect(prisma.postLike.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'me',
            postId: { in: ['p1', 'p2'] },
          }),
        }),
      );

      const p1 = result.data.find(
        (i) => i.type === 'post' && i.post.id === 'p1',
      );
      const p2 = result.data.find(
        (i) => i.type === 'post' && i.post.id === 'p2',
      );
      if (p1?.type === 'post') expect(p1.post.hasLiked).toBe(true);
      if (p2?.type === 'post') expect(p2.post.hasLiked).toBe(false);
    });

    it('posts e eventos competem pelo limite do merge', async () => {
      // Evento entre p2 (now) e p1 (now-2h) — deve entrar no top 2.
      const eventCreatedAt = new Date(now.getTime() - 3600e3);
      mockPrisma.post.findMany.mockResolvedValue([postP1, postP2]);
      mockPrisma.post.count.mockResolvedValue(2);
      mockPrisma.$transaction.mockResolvedValue([
        [
          {
            userId: 'u1',
            watchedAt: eventCreatedAt,
            episode: {
              number: 3,
              anime: { slug: 'frieren', title: 'Frieren', coverImage: null },
            },
          },
        ],
        [],
        [],
        [],
        1,
        0,
        0,
        0,
      ]);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', name: 'Ana', userName: 'ana', avatar: null },
      ]);

      // limit=2: p2 (novo) + evento (meio) entram; p1 fica de fora.
      const result = await service.getFeed(null, 1, 2, 'global');

      expect(result.data).toHaveLength(2);
      const first = result.data[0]!;
      expect(first.type).toBe('post');
      if (first.type === 'post') expect(first.post.id).toBe('p2');

      const second = result.data[1]!;
      expect(second.type).toBe('activity');
      if (second.type === 'activity') expect(second.event.type).toBe('watch');
    });
  });

  describe('getFeed (privacidade)', () => {
    it('feed global exclui posts de perfil privado', async () => {
      // u3 tem profilePublic=false — não retorna no $queryRaw.
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
        .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
        .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
        .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]);
      mockPrisma.post.findMany.mockResolvedValue([]);
      mockPrisma.post.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockResolvedValue([[], [], [], [], 0, 0, 0, 0]);

      await service.getFeed(null, 1, 20, 'global');

      expect(prisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: { in: ['u1', 'u2'] },
          }),
        }),
      );
    });

    it('atividade respeita showActivity/showRatings/showFavorites por usuário', async () => {
      // u1 permite atividade/ratings; u2 só favoritos.
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]) // públicos
        .mockResolvedValueOnce([{ id: 'u1' }]) // showActivity
        .mockResolvedValueOnce([{ id: 'u1' }]) // showRatings
        .mockResolvedValueOnce([{ id: 'u2' }]); // showFavorites
      mockPrisma.post.findMany.mockResolvedValue([]);
      mockPrisma.post.count.mockResolvedValue(0);
      // Dados consistentes com os filtros: watch de u1 (showActivity), rating
      // filtrado para u1 não retorna nada (u2 não permite), favorite de u2.
      mockPrisma.$transaction.mockResolvedValue([
        [
          {
            userId: 'u1',
            watchedAt: new Date(),
            episode: {
              number: 1,
              anime: { slug: 'a', title: 'A', coverImage: null },
            },
          },
        ],
        [], // ratings — u2 não permite showRatings
        [
          {
            userId: 'u2',
            createdAt: new Date(),
            anime: { slug: 'c', title: 'C', coverImage: null },
          },
        ],
        [],
        1,
        0,
        1,
        0,
      ]);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', name: 'Ana', userName: 'ana', avatar: null },
        { id: 'u2', name: 'Bruno', userName: 'bruno', avatar: null },
      ]);

      const result = await service.getFeed(null, 1, 20, 'global');

      // watches filtrados por quem permite showActivity (u1)
      expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: { in: ['u1'] } }),
        }),
      );
      // ratings filtrados por quem permite showRatings (u1) — u2 fica de fora
      expect(prisma.rating.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: { in: ['u1'] } }),
        }),
      );
      // favorites filtrados por quem permite showFavorites (u2)
      expect(prisma.favorite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: { in: ['u2'] } }),
        }),
      );

      // Resultado: só watch (u1) e favorite (u2) — nenhum rating.
      expect(result.data).toHaveLength(2);
      expect(result.data.every((i) => i.type === 'activity')).toBe(true);
      expect(
        result.data.some(
          (i) => i.type === 'activity' && i.event.type === 'rating',
        ),
      ).toBe(false);
    });
  });

  describe('getFeed (following)', () => {
    it('sem sessão → Unauthorized', async () => {
      await expect(service.getFeed(null, 1, 20, 'following')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('sem follows → feed vazio', async () => {
      mockPrisma.follow.findMany.mockResolvedValue([]);

      const result = await service.getFeed('me', 1, 20, 'following');

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(prisma.post.findMany).not.toHaveBeenCalled();
    });

    it('limita a quem eu sigo (in dos followeeIds)', async () => {
      mockPrisma.follow.findMany.mockResolvedValue([
        { followeeId: 'u2' },
        { followeeId: 'u3' },
      ]);
      // No escopo following o $queryRaw só roda para os 3 flags.
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'u2' }, { id: 'u3' }])
        .mockResolvedValueOnce([{ id: 'u2' }, { id: 'u3' }])
        .mockResolvedValueOnce([{ id: 'u2' }, { id: 'u3' }]);
      mockPrisma.post.findMany.mockResolvedValue([]);
      mockPrisma.post.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockResolvedValue([[], [], [], [], 0, 0, 0, 0]);

      await service.getFeed('me', 1, 20, 'following');

      expect(prisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: { in: ['u2', 'u3'] },
          }),
        }),
      );
    });
  });
});
