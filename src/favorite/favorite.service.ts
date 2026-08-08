import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class FavoriteService {
  constructor(private readonly prisma: PrismaService) {}

  async toggle(userId: string, animeSlug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const existing = await this.prisma.favorite.findUnique({
      where: {
        userId_animeId: { userId, animeId: anime.id },
      },
    });

    if (existing) {
      await this.prisma.favorite.delete({
        where: { userId_animeId: { userId, animeId: anime.id } },
      });
      return { favorited: false, message: 'Removido dos favoritos.' };
    }

    await this.prisma.favorite.create({
      data: { userId, animeId: anime.id },
    });
    return { favorited: true, message: 'Adicionado aos favoritos.' };
  }

  async list(userId: string, page = 1, limit = 24) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    const [favorites, total] = await this.prisma.$transaction([
      this.prisma.favorite.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        include: {
          anime: {
            include: { genres: true },
          },
        },
      }),
      this.prisma.favorite.count({ where: { userId } }),
    ]);

    return {
      data: favorites.map((f) => f.anime),
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async check(userId: string, animeSlug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const favorite = await this.prisma.favorite.findUnique({
      where: {
        userId_animeId: { userId, animeId: anime.id },
      },
    });

    return { favorited: !!favorite };
  }
}
