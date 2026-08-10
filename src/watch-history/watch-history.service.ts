import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateProgressDto } from '@/watch-history/dto/update-progress.dto';

@Injectable()
export class WatchHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProgress(
    userId: string,
    animeSlug: string,
    episodeNumber: number,
    dto: UpdateProgressDto,
  ) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: anime.id,
          season: 1,
          number: episodeNumber,
        },
      },
      select: { id: true, duration: true },
    });

    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }

    const completed =
      dto.completed ?? this.checkCompleted(dto.progress, dto.duration);

    return this.prisma.watchHistory.upsert({
      where: {
        userId_episodeId: { userId, episodeId: episode.id },
      },
      update: {
        progress: dto.progress,
        duration: dto.duration,
        completed,
        watchedAt: new Date(),
      },
      create: {
        userId,
        episodeId: episode.id,
        progress: dto.progress,
        duration: dto.duration,
        completed,
      },
    });
  }

  async getContinueWatching(userId: string, limit = 12) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    const histories = await this.prisma.watchHistory.findMany({
      where: {
        userId,
        completed: false,
      },
      orderBy: { watchedAt: 'desc' },
      take: safeLimit,
      include: {
        episode: {
          include: {
            anime: { include: { genres: true } },
          },
        },
      },
    });

    return histories.map((h) => ({
      episodeId: h.episodeId,
      progress: h.progress,
      duration: h.duration,
      watchedAt: h.watchedAt,
      completed: h.completed,
      episode: {
        id: h.episode.id,
        number: h.episode.number,
        title: h.episode.title,
        thumbnailUrl: h.episode.thumbnailUrl,
        duration: h.episode.duration,
      },
      anime: h.episode.anime,
    }));
  }

  async getHistory(userId: string, page = 1, limit = 24) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    const [histories, total] = await this.prisma.$transaction([
      this.prisma.watchHistory.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { watchedAt: 'desc' },
        include: {
          episode: {
            include: {
              anime: {
                select: { id: true, slug: true, title: true, coverImage: true },
              },
            },
          },
        },
      }),
      this.prisma.watchHistory.count({ where: { userId } }),
    ]);

    return {
      data: histories.map((h) => ({
        episodeId: h.episodeId,
        progress: h.progress,
        completed: h.completed,
        watchedAt: h.watchedAt,
        episode: {
          id: h.episode.id,
          number: h.episode.number,
          title: h.episode.title,
        },
        anime: h.episode.anime,
      })),
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  private checkCompleted(progress: number, duration?: number): boolean {
    if (!duration || duration <= 0) return false;
    return progress / duration >= 0.9;
  }
}
