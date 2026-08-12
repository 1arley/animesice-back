import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { ContentStatus, NotificationType, Prisma } from '@prisma/client';
import { CreatePostCommentDto, CreatePostDto } from '@/social/dto/social.dto';
import { PROFILE_PUBLIC_OR_EMPTY } from '@/common/prisma-filters';

const MAX_POST_LENGTH = 2000;

/** Shape público de um post — alinhado com src/types (animesice-web). */
const POST_SELECT = {
  id: true,
  content: true,
  animeId: true,
  shareCount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  anime: { select: { id: true, slug: true, title: true, coverImage: true } },
  user: { select: { id: true, name: true, userName: true, avatar: true } },
  _count: {
    select: {
      likes: true,
      // Só conta comentários visíveis — ocultos por moderação não inflam o badge.
      comments: { where: { status: ContentStatus.VISIBLE } },
    },
  },
} satisfies Prisma.PostSelect;

const POST_COMMENT_SELECT = {
  id: true,
  postId: true,
  content: true,
  createdAt: true,
  user: { select: { id: true, name: true, userName: true, avatar: true } },
} satisfies Prisma.PostCommentSelect;

const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  userName: true,
  avatar: true,
  bio: true,
  createdAt: true,
  _count: {
    select: { comments: true, ratings: true, favorites: true },
  },
} satisfies Prisma.UserSelect;

type ActivityFlag = 'showActivity' | 'showRatings' | 'showFavorites';

/**
 * SocialService — posts de texto livre + follow entre usuários + feed que
 * mescla posts com a atividade pública (assistidos, avaliações, favoritos,
 * comentários) dos mesmos autores, no mesmo padrão de /me/activity.
 */
@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // ------------------------------------------------------------------
  // Posts
  // ------------------------------------------------------------------

  async createPost(userId: string, dto: CreatePostDto) {
    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('O post não pode ser vazio.');
    }
    if (content.length > MAX_POST_LENGTH) {
      throw new BadRequestException(
        `O post deve ter no máximo ${MAX_POST_LENGTH} caracteres.`,
      );
    }

    if (dto.animeId) {
      const anime = await this.prisma.anime.findUnique({
        where: { id: dto.animeId },
        select: { id: true },
      });
      if (!anime) {
        throw new BadRequestException('Anime referenciado não encontrado.');
      }
    }

    const post = await this.prisma.post.create({
      data: { userId, content, animeId: dto.animeId ?? null },
      select: POST_SELECT,
    });

    return { ...post, hasLiked: false };
  }

  async getPost(postId: string, currentUserId: string | null) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: ContentStatus.VISIBLE },
      select: POST_SELECT,
    });

    if (!post) {
      throw new NotFoundException('Post não encontrado.');
    }

    const hasLiked = currentUserId
      ? !!(await this.prisma.postLike.findUnique({
          where: { userId_postId: { userId: currentUserId, postId } },
          select: { userId: true },
        }))
      : false;

    return { ...post, hasLiked };
  }

  async deletePost(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, userId: true },
    });

    if (!post) {
      throw new NotFoundException('Post não encontrado.');
    }
    if (post.userId !== userId) {
      throw new ForbiddenException('Você só pode excluir os próprios posts.');
    }

    await this.prisma.post.delete({ where: { id: postId } });
    return { message: 'Post removido.' };
  }

  async togglePostLike(userId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: ContentStatus.VISIBLE },
      select: { id: true, userId: true, content: true },
    });

    if (!post) {
      throw new NotFoundException('Post não encontrado.');
    }

    const existing = await this.prisma.postLike.findUnique({
      where: { userId_postId: { userId, postId } },
      select: { createdAt: true },
    });

    if (existing) {
      await this.prisma.postLike.delete({
        where: { userId_postId: { userId, postId } },
      });
      return { liked: false };
    }

    await this.prisma.postLike.create({ data: { userId, postId } });

    if (post.userId !== userId) {
      const liker = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, userName: true },
      });
      void this.notificationService.create({
        userId: post.userId,
        type: NotificationType.POST_LIKE,
        title: `${liker?.name ?? liker?.userName ?? 'Alguém'} curtiu seu post`,
        body:
          post.content.length > 80
            ? `${post.content.slice(0, 80)}…`
            : post.content,
        linkUrl: '/comunidade/feed',
      });
    }

    return { liked: true };
  }

  async getPostComments(postId: string, page = 1, limit = 20) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: ContentStatus.VISIBLE },
      select: { id: true },
    });
    if (!post) {
      throw new NotFoundException('Post não encontrado.');
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [comments, total] = await this.prisma.$transaction([
      this.prisma.postComment.findMany({
        where: { postId, status: ContentStatus.VISIBLE },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'asc' },
        select: POST_COMMENT_SELECT,
      }),
      this.prisma.postComment.count({
        where: { postId, status: ContentStatus.VISIBLE },
      }),
    ]);

    return {
      data: comments,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async createPostComment(
    userId: string,
    postId: string,
    dto: CreatePostCommentDto,
  ) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: ContentStatus.VISIBLE },
      select: { id: true, userId: true, content: true },
    });
    if (!post) {
      throw new NotFoundException('Post não encontrado.');
    }

    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('O comentário não pode ser vazio.');
    }

    const comment = await this.prisma.postComment.create({
      data: { postId, userId, content },
      select: POST_COMMENT_SELECT,
    });

    if (post.userId !== userId) {
      const author = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, userName: true },
      });
      void this.notificationService.create({
        userId: post.userId,
        type: NotificationType.POST_COMMENT,
        title: `${
          author?.name ?? author?.userName ?? 'Alguém'
        } comentou no seu post`,
        linkUrl: '/comunidade/feed',
      });
    }

    return comment;
  }

  async sharePost(postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: ContentStatus.VISIBLE },
      select: { id: true },
    });
    if (!post) {
      throw new NotFoundException('Post não encontrado.');
    }

    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: { shareCount: { increment: 1 } },
      select: { shareCount: true },
    });

    return { shared: true, shareCount: updated.shareCount };
  }

  // ------------------------------------------------------------------
  // Follow
  // ------------------------------------------------------------------

  async toggleFollow(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new BadRequestException('Você não pode seguir a si mesmo.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, userName: true },
    });
    if (!target) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const existing = await this.prisma.follow.findUnique({
      where: {
        followerId_followeeId: { followerId: userId, followeeId: targetUserId },
      },
      select: { createdAt: true },
    });

    if (existing) {
      await this.prisma.follow.delete({
        where: {
          followerId_followeeId: {
            followerId: userId,
            followeeId: targetUserId,
          },
        },
      });
      return { following: false };
    }

    await this.prisma.follow.create({
      data: { followerId: userId, followeeId: targetUserId },
    });

    const follower = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, userName: true },
    });
    void this.notificationService.create({
      userId: targetUserId,
      type: NotificationType.NEW_FOLLOW,
      title: `${
        follower?.name ?? follower?.userName ?? 'Alguém'
      } começou a seguir você`,
      linkUrl: `/users/${target.userName ?? targetUserId}`,
    });

    return { following: true };
  }

  async checkFollow(userId: string, targetUserId: string) {
    const following = !!(await this.prisma.follow.findUnique({
      where: {
        followerId_followeeId: { followerId: userId, followeeId: targetUserId },
      },
      select: { createdAt: true },
    }));
    return { following };
  }

  async getFollowing(userId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [follows, total] = await this.prisma.$transaction([
      this.prisma.follow.findMany({
        where: { followerId: userId },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: { followee: { select: PUBLIC_USER_SELECT } },
      }),
      this.prisma.follow.count({ where: { followerId: userId } }),
    ]);

    return {
      data: follows.map((f) => ({ ...f.followee, isFollowing: true })),
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getFollowers(
    targetUserId: string,
    currentUserId: string | null,
    page = 1,
    limit = 20,
  ) {
    const target = await this.resolvePublicTarget(targetUserId);

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    // Perfis privados não aparecem nas listas públicas — mesma regra do feed.
    const [follows, total] = await this.prisma.$transaction([
      this.prisma.follow.findMany({
        where: { followeeId: target.id, follower: PROFILE_PUBLIC_OR_EMPTY },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: { follower: { select: PUBLIC_USER_SELECT } },
      }),
      this.prisma.follow.count({
        where: { followeeId: target.id, follower: PROFILE_PUBLIC_OR_EMPTY },
      }),
    ]);

    const data = await this.withFollowingFlags(
      follows.map((f) => f.follower),
      currentUserId,
    );

    return {
      data,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Quem um usuário segue (lista pública, espelhando getFollowers):
   * com isFollowing marcado para o visitante logado quando aplicável.
   */
  async getFollowingForUser(
    targetUserId: string,
    currentUserId: string | null,
    page = 1,
    limit = 20,
  ) {
    const target = await this.resolvePublicTarget(targetUserId);

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    // Perfis privados não aparecem nas listas públicas — mesma regra do feed.
    const [follows, total] = await this.prisma.$transaction([
      this.prisma.follow.findMany({
        where: { followerId: target.id, followee: PROFILE_PUBLIC_OR_EMPTY },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: { followee: { select: PUBLIC_USER_SELECT } },
      }),
      this.prisma.follow.count({
        where: { followerId: target.id, followee: PROFILE_PUBLIC_OR_EMPTY },
      }),
    ]);

    const data = await this.withFollowingFlags(
      follows.map((f) => f.followee),
      currentUserId,
    );

    return {
      data,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Resolve o alvo das listas públicas de follow exigindo perfil público
   * (mesma regra de /users/:id) — perfil privado responde 404.
   */
  private async resolvePublicTarget(targetUserId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, ...PROFILE_PUBLIC_OR_EMPTY },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    return target;
  }

  /**
   * Marca isFollowing (para o visitante logado) numa lista de usuários
   * públicos — comum às listas de seguidores/seguindo do perfil.
   */
  private async withFollowingFlags(
    users: Array<{ id: string }>,
    currentUserId: string | null,
  ): Promise<Array<{ id: string } & { isFollowing: boolean }>> {
    if (!currentUserId || users.length === 0) {
      return users.map((u) => ({ ...u, isFollowing: false }));
    }
    const myFollows = await this.prisma.follow.findMany({
      where: {
        followerId: currentUserId,
        followeeId: { in: users.map((u) => u.id) },
      },
      select: { followeeId: true },
    });
    const followingIds = new Set(myFollows.map((f) => f.followeeId));
    return users.map((u) => ({ ...u, isFollowing: followingIds.has(u.id) }));
  }

  // ------------------------------------------------------------------
  // Feed
  // ------------------------------------------------------------------

  async getFeed(
    currentUserId: string | null,
    page = 1,
    limit = 20,
    scope: 'global' | 'following' = 'global',
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const skip = (page - 1) * safeLimit;

    let userIds: string[];

    if (scope === 'following') {
      if (!currentUserId) {
        throw new UnauthorizedException(
          'Entre para ver o feed de quem você segue.',
        );
      }
      const follows = await this.prisma.follow.findMany({
        where: { followerId: currentUserId },
        select: { followeeId: true },
      });
      userIds = follows.map((f) => f.followeeId);
      if (userIds.length === 0) {
        return {
          data: [],
          meta: { total: 0, page, limit: safeLimit, totalPages: 0 },
        };
      }
    } else {
      // Global: apenas autores com perfil público (privacidade ausente = público).
      userIds = await this.getPublicUserIds();
      if (userIds.length === 0) {
        return {
          data: [],
          meta: { total: 0, page, limit: safeLimit, totalPages: 0 },
        };
      }
    }

    return this.buildFeed(currentUserId, userIds, skip, safeLimit, page);
  }

  /**
   * Monta a página do feed mesclando posts + eventos de atividade.
   *
   * Tradeoff conhecido (mesmo padrão de /me/activity): cada fonte usa uma
   * janela skip/take própria, então itens que não entram no merge de uma
   * página não aparecem em páginas seguintes — páginas são cronológicas,
   * mas não estritamente disjuntas. Total é o somatório honesto das fontes.
   */
  private async buildFeed(
    currentUserId: string | null,
    userIds: string[],
    skip: number,
    limit: number,
    page: number,
  ) {
    const [posts, totalPosts, watchIds, ratingIds, favIds] = await Promise.all([
      this.prisma.post.findMany({
        where: { userId: { in: userIds }, status: ContentStatus.VISIBLE },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: POST_SELECT,
      }),
      this.prisma.post.count({
        where: { userId: { in: userIds }, status: ContentStatus.VISIBLE },
      }),
      this.getUserIdsWithFlag('showActivity', userIds),
      this.getUserIdsWithFlag('showRatings', userIds),
      this.getUserIdsWithFlag('showFavorites', userIds),
    ]);

    const [
      watches,
      ratings,
      favorites,
      comments,
      watchCount,
      ratingCount,
      favCount,
      commentCount,
    ] = await this.prisma.$transaction([
      this.prisma.watchHistory.findMany({
        where: { userId: { in: watchIds } },
        skip,
        take: limit,
        orderBy: { watchedAt: 'desc' },
        select: {
          userId: true,
          watchedAt: true,
          episode: {
            select: {
              number: true,
              anime: { select: { slug: true, title: true, coverImage: true } },
            },
          },
        },
      }),
      this.prisma.rating.findMany({
        where: { userId: { in: ratingIds } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          userId: true,
          score: true,
          createdAt: true,
          anime: { select: { slug: true, title: true, coverImage: true } },
        },
      }),
      this.prisma.favorite.findMany({
        where: { userId: { in: favIds } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          userId: true,
          createdAt: true,
          anime: { select: { slug: true, title: true, coverImage: true } },
        },
      }),
      this.prisma.comment.findMany({
        where: { userId: { in: watchIds }, status: ContentStatus.VISIBLE },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          userId: true,
          id: true,
          content: true,
          edited: true,
          createdAt: true,
          anime: { select: { slug: true, title: true } },
          _count: { select: { likes: true } },
        },
      }),
      this.prisma.watchHistory.count({ where: { userId: { in: watchIds } } }),
      this.prisma.rating.count({ where: { userId: { in: ratingIds } } }),
      this.prisma.favorite.count({ where: { userId: { in: favIds } } }),
      this.prisma.comment.count({
        where: { userId: { in: watchIds }, status: ContentStatus.VISIBLE },
      }),
    ]);

    // Map de usuários para os eventos de atividade (posts já trazem o autor).
    const eventUserIds = [
      ...new Set([
        ...watches.map((w) => w.userId),
        ...ratings.map((r) => r.userId),
        ...favorites.map((f) => f.userId),
        ...comments.map((c) => c.userId),
      ]),
    ];
    const users = eventUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: eventUserIds } },
          select: { id: true, name: true, userName: true, avatar: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const events = [
      ...watches.map((w) => ({
        type: 'watch' as const,
        userId: w.userId,
        episodeNumber: w.episode.number,
        anime: w.episode.anime,
        createdAt: w.watchedAt.toISOString(),
      })),
      ...ratings.map((r) => ({
        type: 'rating' as const,
        userId: r.userId,
        score: r.score,
        anime: r.anime,
        createdAt: r.createdAt.toISOString(),
      })),
      ...favorites.map((f) => ({
        type: 'favorite' as const,
        userId: f.userId,
        anime: f.anime,
        createdAt: f.createdAt.toISOString(),
      })),
      ...comments.map((c) => ({
        type: 'comment' as const,
        userId: c.userId,
        id: c.id,
        content: c.content,
        edited: c.edited,
        likeCount: c._count.likes,
        anime: c.anime,
        createdAt: c.createdAt.toISOString(),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    // hasLiked dos posts (para o usuário logado).
    let likedPostIds = new Set<string>();
    if (currentUserId && posts.length > 0) {
      const likes = await this.prisma.postLike.findMany({
        where: {
          userId: currentUserId,
          postId: { in: posts.map((p) => p.id) },
        },
        select: { postId: true },
      });
      likedPostIds = new Set(likes.map((l) => l.postId));
    }

    const items = [
      ...posts.map((p) => ({
        type: 'post' as const,
        createdAt: p.createdAt.toISOString(),
        post: { ...p, hasLiked: likedPostIds.has(p.id) },
      })),
      ...events.slice(0, limit).map((e) => ({
        type: 'activity' as const,
        createdAt: e.createdAt,
        event: {
          type: e.type,
          ...(e.type === 'watch'
            ? { episodeNumber: e.episodeNumber, anime: e.anime }
            : {}),
          ...(e.type === 'rating' ? { score: e.score, anime: e.anime } : {}),
          ...(e.type === 'favorite' ? { anime: e.anime } : {}),
          ...(e.type === 'comment'
            ? {
                id: e.id,
                content: e.content,
                edited: e.edited,
                likeCount: e.likeCount,
                anime: e.anime,
              }
            : {}),
          createdAt: e.createdAt,
        },
        user: userById.get(e.userId),
      })),
    ]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
      .map(({ createdAt: _createdAt, ...rest }) => rest);

    const total =
      totalPosts + watchCount + ratingCount + favCount + commentCount;

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** IDs de usuários com perfil público (privacidade ausente = público). */
  private async getPublicUserIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM "User" u
      LEFT JOIN "PrivacySettings" p ON p."userId" = u.id
      WHERE COALESCE(p."profilePublic", true) = true
    `;
    return rows.map((r) => r.id);
  }

  /**
   * IDs de usuários públicos que permitem uma fonte de atividade específica
   * (showActivity/showRatings/showFavorites). Opcionalmente restrito a um
   * conjunto (`within`) — usado no feed "following".
   */
  private async getUserIdsWithFlag(
    flag: ActivityFlag,
    within: string[],
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM "User" u
      LEFT JOIN "PrivacySettings" p ON p."userId" = u.id
      WHERE COALESCE(p."profilePublic", true) = true
        AND COALESCE(p."${Prisma.raw(flag)}", true) = true
        ${within.length > 0 ? Prisma.sql`AND u.id = ANY(${within})` : Prisma.empty}
    `;
    return rows.map((r) => r.id);
  }
}
