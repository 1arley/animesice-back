import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        userName: true,
        role: true,
        isVerified: true,
        avatar: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateMeDto) {
    const data: Record<string, string | null> = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.bio !== undefined) data.bio = dto.bio;

    if (dto.userName !== undefined && dto.userName !== null) {
      const normalized = dto.userName.trim().toLowerCase();
      if (normalized) {
        const existing = await this.prisma.user.findUnique({
          where: { userName: normalized },
        });
        if (existing && existing.id !== userId) {
          throw new ConflictException('Este apelido já está em uso.');
        }
        data.userName = normalized;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new NotFoundException('Nada para atualizar.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        userName: true,
        role: true,
        isVerified: true,
        avatar: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getMyActivity(userId: string, page: number = 1, limit: number = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [comments, ratings, favorites, total] =
      await this.prisma.$transaction([
        this.prisma.comment.findMany({
          where: { userId },
          skip,
          take: safeLimit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            content: true,
            animeId: true,
            episodeId: true,
            parentId: true,
            edited: true,
            status: true,
            createdAt: true,
            anime: { select: { slug: true, title: true } },
          },
        }),
        this.prisma.rating.findMany({
          where: { userId },
          skip,
          take: safeLimit,
          orderBy: { createdAt: 'desc' },
          select: {
            score: true,
            animeId: true,
            anime: { select: { slug: true, title: true } },
            createdAt: true,
          },
        }),
        this.prisma.favorite.findMany({
          where: { userId },
          skip,
          take: safeLimit,
          orderBy: { createdAt: 'desc' },
          select: {
            animeId: true,
            anime: { select: { slug: true, title: true, coverImage: true } },
            createdAt: true,
          },
        }),
        this.prisma.comment.count({ where: { userId } }),
      ]);

    const interleaved = [
      ...comments.map((c) => ({ type: 'comment' as const, ...c })),
      ...ratings.map((r) => ({ type: 'rating' as const, ...r })),
      ...favorites.map((f) => ({ type: 'favorite' as const, ...f })),
    ].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

    return {
      data: interleaved.slice(0, safeLimit),
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getMyStats(userId: string) {
    const [comments, ratings, favorites, watchHistories, animeList] =
      await this.prisma.$transaction([
        this.prisma.comment.count({ where: { userId } }),
        this.prisma.rating.count({ where: { userId } }),
        this.prisma.favorite.count({ where: { userId } }),
        this.prisma.watchHistory.count({ where: { userId } }),
        this.prisma.userAnimeList.count({ where: { userId } }),
      ]);

    return { comments, ratings, favorites, watchHistories, animeList };
  }

  async getMyPublicView(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

  async deleteMe(userId: string) {
    await this.prisma.user.delete({ where: { id: userId } });
    return { message: 'Conta excluída com sucesso.' };
  }
}
