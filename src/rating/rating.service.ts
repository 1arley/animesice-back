import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RateAnimeDto } from '@/rating/dto/rate-anime.dto';

@Injectable()
export class RatingService {
  constructor(private readonly prisma: PrismaService) {}

  async rate(userId: string, animeSlug: string, dto: RateAnimeDto) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const rating = await this.prisma.rating.upsert({
      where: {
        userId_animeId: { userId, animeId: anime.id },
      },
      update: { score: dto.score },
      create: { userId, animeId: anime.id, score: dto.score },
    });

    await this.updateAnimeRating(anime.id);

    return rating;
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
      await this.prisma.rating.delete({
        where: {
          userId_animeId: { userId, animeId: anime.id },
        },
      });
    } catch {
      throw new NotFoundException('Avaliação não encontrada.');
    }

    await this.updateAnimeRating(anime.id);

    return { message: 'Avaliação removida.' };
  }

  async getUserRating(userId: string, animeSlug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const rating = await this.prisma.rating.findUnique({
      where: {
        userId_animeId: { userId, animeId: anime.id },
      },
    });

    return rating ?? null;
  }

  async getAnimeStats(animeSlug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const [aggregations, count] = await Promise.all([
      this.prisma.rating.aggregate({
        where: { animeId: anime.id },
        _avg: { score: true },
        _min: { score: true },
        _max: { score: true },
      }),
      this.prisma.rating.count({
        where: { animeId: anime.id },
      }),
    ]);

    return {
      average: aggregations._avg.score ?? null,
      count,
      min: aggregations._min.score ?? null,
      max: aggregations._max.score ?? null,
    };
  }

  private async updateAnimeRating(animeId: string) {
    // Atomic: compute average + update in a single SQL statement to prevent
    // stale reads under concurrent rating submissions.
    await this.prisma.$executeRaw`
      UPDATE "Anime"
      SET "rating" = COALESCE((
        SELECT AVG("score") FROM "Rating" WHERE "animeId" = ${animeId}
      ), 0)
      WHERE "id" = ${animeId}
    `;
  }
}
