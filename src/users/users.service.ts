import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ReportReason } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve um identificador de usuário — aceita UUID ou apelido (userName).
   * Todos os endpoints públicos de perfil usam isto, permitindo URLs
   * amigáveis como /users/iarley além do /users/<uuid> legado.
   */
  private async resolveUser(identifier: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: identifier }, { userName: identifier }] },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    return user.id;
  }

  /** Carrega preferências de privacidade do usuário (defaults p/ ausente). */
  private async getPrivacy(userId: string) {
    const p = await this.prisma.privacySettings.findUnique({
      where: { userId },
    });
    return {
      profilePublic: p?.profilePublic ?? true,
      showActivity: p?.showActivity ?? true,
      showFavorites: p?.showFavorites ?? true,
      showRatings: p?.showRatings ?? true,
    };
  }

  async getPublicProfile(identifier: string) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        userName: true,
        avatar: true,
        bio: true,
        myAnimeList: true,
        createdAt: true,
        _count: {
          select: {
            comments: privacy.showActivity,
            ratings: privacy.showRatings,
            favorites: privacy.showFavorites,
            watchHistories: privacy.showActivity,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user;
  }

  async getUserComments(
    identifier: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.showActivity) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [comments, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where: { userId, status: 'VISIBLE' },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          content: true,
          edited: true,
          createdAt: true,
          anime: { select: { slug: true, title: true } },
        },
      }),
      this.prisma.comment.count({ where: { userId, status: 'VISIBLE' } }),
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

  async getUserRatings(
    identifier: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.showRatings) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [ratings, total] = await this.prisma.$transaction([
      this.prisma.rating.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          score: true,
          createdAt: true,
          updatedAt: true,
          anime: {
            select: { id: true, slug: true, title: true, coverImage: true },
          },
        },
      }),
      this.prisma.rating.count({ where: { userId } }),
    ]);

    return {
      data: ratings,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getUserFavorites(
    identifier: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.showFavorites) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [favorites, total] = await this.prisma.$transaction([
      this.prisma.favorite.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          anime: {
            select: {
              id: true,
              slug: true,
              title: true,
              coverImage: true,
              year: true,
              format: true,
            },
          },
        },
      }),
      this.prisma.favorite.count({ where: { userId } }),
    ]);

    return {
      data: favorites,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getUserAnimeList(
    identifier: string,
    page: number = 1,
    limit: number = 24,
    status?: string,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.showFavorites) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const where: Record<string, unknown> = { userId, private: false };
    if (status) where.status = status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userAnimeList.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: { updatedAt: 'desc' },
        include: {
          anime: {
            select: {
              id: true,
              slug: true,
              title: true,
              coverImage: true,
              year: true,
              format: true,
              genres: true,
              episodeCount: true,
            },
          },
        },
      }),
      this.prisma.userAnimeList.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Atividade pública recente — feed cronológico mesclando assistidos,
   * avaliações, favoritos e comentários (gatado por showActivity).
   *
   * Paginação por janela deslocada por fonte (skip/take): cada página é
   * internamente cronológica e não repete eventos entre páginas — o mesmo
   * padrão já usado por /me/activity para o feed do próprio usuário.
   */
  async getUserActivity(
    identifier: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.showActivity) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

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
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { watchedAt: 'desc' },
        select: {
          watchedAt: true,
          episode: {
            select: {
              number: true,
              anime: {
                select: { slug: true, title: true, coverImage: true },
              },
            },
          },
        },
      }),
      this.prisma.rating.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          score: true,
          createdAt: true,
          anime: {
            select: { slug: true, title: true, coverImage: true },
          },
        },
      }),
      this.prisma.favorite.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          anime: {
            select: { slug: true, title: true, coverImage: true },
          },
        },
      }),
      this.prisma.comment.findMany({
        where: { userId, status: 'VISIBLE' },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          content: true,
          edited: true,
          createdAt: true,
          anime: { select: { slug: true, title: true } },
          _count: { select: { likes: true } },
        },
      }),
      this.prisma.watchHistory.count({ where: { userId } }),
      this.prisma.rating.count({ where: { userId } }),
      this.prisma.favorite.count({ where: { userId } }),
      this.prisma.comment.count({ where: { userId, status: 'VISIBLE' } }),
    ]);

    const events = [
      ...watches.map((w) => ({
        type: 'watch' as const,
        episodeNumber: w.episode.number,
        anime: w.episode.anime,
        createdAt: w.watchedAt.toISOString(),
      })),
      ...ratings.map((r) => ({
        type: 'rating' as const,
        score: r.score,
        anime: r.anime,
        createdAt: r.createdAt.toISOString(),
      })),
      ...favorites.map((f) => ({
        type: 'favorite' as const,
        anime: f.anime,
        createdAt: f.createdAt.toISOString(),
      })),
      ...comments.map((c) => ({
        type: 'comment' as const,
        id: c.id,
        content: c.content,
        edited: c.edited,
        likeCount: c._count.likes,
        anime: c.anime,
        createdAt: c.createdAt.toISOString(),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const total = watchCount + ratingCount + favCount + commentCount;

    return {
      data: events.slice(0, safeLimit),
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getUserStats(identifier: string) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        _count: {
          select: {
            comments: privacy.showActivity,
            ratings: privacy.showRatings,
            favorites: privacy.showFavorites,
            watchHistories: privacy.showActivity,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user._count;
  }

  async reportUser(
    reporterId: string,
    identifier: string,
    reason: ReportReason,
    notes?: string,
  ) {
    const targetUserId = await this.resolveUser(identifier);

    if (reporterId === targetUserId) {
      throw new BadRequestException('Você não pode denunciar a si mesmo.');
    }

    return this.prisma.report.create({
      data: {
        reporterId,
        targetType: 'USER',
        targetId: targetUserId,
        reason,
        notes,
      },
      include: {
        reporter: { select: { id: true, name: true, userName: true } },
      },
    });
  }
}
