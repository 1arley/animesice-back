import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  ADULT_AGE_RATING,
  ADULT_GENRE_SLUG,
  shouldExcludeAdult,
} from '@/common/adult';

@Injectable()
export class EpisodeService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAnimeSlug(slug: string) {
    const anime = await this.prisma.anime.findFirst({
      where: { slug, published: true },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    return this.prisma.episode.findMany({
      where: { animeId: anime.id },
      orderBy: { number: 'asc' },
    });
  }

  async findByAnimeSlugAndNumber(
    slug: string,
    number: number,
    season: number = 1,
  ) {
    const anime = await this.prisma.anime.findFirst({
      where: { slug, published: true },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: anime.id,
          season,
          number,
        },
      },
      include: { anime: true },
    });

    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }

    return episode;
  }

  async incrementViews(slug: string, number: number, season: number = 1) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: { animeId: anime.id, season, number },
      },
      select: { id: true },
    });

    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }

    await this.prisma.episode.update({
      where: { id: episode.id },
      data: { views: { increment: 1 } },
    });

    return { message: 'View incrementada.' };
  }

  async findLatest(limit: number = 12) {
    return this.prisma.episode.findMany({
      take: limit,
      orderBy: { updatedAt: 'desc' },
      where: shouldExcludeAdult()
        ? {
            anime: {
              published: true,
              ageRating: { not: ADULT_AGE_RATING },
              NOT: { genres: { some: { slug: ADULT_GENRE_SLUG } } },
            },
          }
        : undefined,
      include: { anime: true },
    });
  }
}
