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

  async getPublicProfile(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        userName: true,
        avatar: true,
        bio: true,
        createdAt: true,
        _count: {
          select: {
            comments: true,
            ratings: true,
            favorites: true,
            watchHistories: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user;
  }

  async getUserComments(id: string, page: number = 1, limit: number = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [comments, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where: { userId: id, status: 'VISIBLE' },
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
      this.prisma.comment.count({ where: { userId: id, status: 'VISIBLE' } }),
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

  async getUserRatings(id: string, page: number = 1, limit: number = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [ratings, total] = await this.prisma.$transaction([
      this.prisma.rating.findMany({
        where: { userId: id },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          score: true,
          createdAt: true,
          anime: { select: { slug: true, title: true, coverImage: true } },
        },
      }),
      this.prisma.rating.count({ where: { userId: id } }),
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

  async getUserFavorites(id: string, page: number = 1, limit: number = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [favorites, total] = await this.prisma.$transaction([
      this.prisma.favorite.findMany({
        where: { userId: id },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          anime: { select: { slug: true, title: true, coverImage: true } },
        },
      }),
      this.prisma.favorite.count({ where: { userId: id } }),
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

  async getUserStats(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        _count: {
          select: {
            comments: true,
            ratings: true,
            favorites: true,
            watchHistories: true,
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
    targetUserId: string,
    reason: ReportReason,
    notes?: string,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!target) {
      throw new NotFoundException('Usuário não encontrado.');
    }

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
