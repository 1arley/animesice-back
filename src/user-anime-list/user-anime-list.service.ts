import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { UpdateUserAnimeListDto } from '@/user-anime-list/dto/update-user-anime-list.dto';
import { WatchStatus } from '@prisma/client';
import { parsePageParam } from '@/common/constants';

@Injectable()
export class UserAnimeListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async upsert(userId: string, animeSlug: string, dto: UpdateUserAnimeListDto) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true, title: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const data: Parameters<
      typeof this.prisma.userAnimeList.upsert
    >[0]['create'] = {
      userId,
      animeId: anime.id,
      status: dto.status ?? WatchStatus.PLANNING,
      episodesWatched: dto.episodesWatched ?? 0,
      score: dto.score,
      notes: dto.notes,
      rewatchCount: dto.rewatchCount ?? 0,
      private: dto.private ?? false,
      startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
      completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
    };

    if (dto.status === WatchStatus.COMPLETED) {
      if (!data.completedAt) data.completedAt = new Date();
    }

    const item = await this.prisma.userAnimeList.upsert({
      where: {
        userId_animeId: { userId, animeId: anime.id },
      },
      create: data,
      update: {
        ...dto,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
        completedAt: dto.completedAt
          ? new Date(dto.completedAt)
          : dto.status === WatchStatus.COMPLETED
            ? new Date()
            : undefined,
      },
      include: {
        anime: { include: { genres: true } },
      },
    });

    return item;
  }

  async remove(userId: string, animeSlug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    try {
      await this.prisma.userAnimeList.delete({
        where: {
          userId_animeId: { userId, animeId: anime.id },
        },
      });
    } catch {
      throw new NotFoundException('Item não encontrado na sua lista.');
    }

    return { message: 'Removido da lista.' };
  }

  async list(
    userId: string,
    page: string | undefined,
    limit: string | undefined,
    status?: string,
  ) {
    const pageNumber = parsePageParam(page, 1);
    const limitNumber = parsePageParam(limit, 24);
    const skip = (pageNumber - 1) * limitNumber;

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userAnimeList.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy: { updatedAt: 'desc' },
        include: {
          anime: { include: { genres: true } },
        },
      }),
      this.prisma.userAnimeList.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  async getPublicList(userId: string, page = 1, limit = 24) {
    const skip = (page - 1) * limit;

    const where = {
      userId,
      private: false,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userAnimeList.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          anime: {
            select: {
              id: true,
              slug: true,
              title: true,
              coverImage: true,
              genres: true,
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
        limit,
        totalPages: Math.ceil(total / limit),
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

    const item = await this.prisma.userAnimeList.findUnique({
      where: {
        userId_animeId: { userId, animeId: anime.id },
      },
    });

    return item ? { inList: true, status: item.status } : { inList: false };
  }
}
