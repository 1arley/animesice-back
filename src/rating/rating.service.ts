import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RateAnimeDto } from '@/rating/dto/rate-anime.dto';

@Injectable()
export class RatingService {
  constructor(private readonly prisma: PrismaService) {}

  async rate(userId: string, animeSlug: string, dto: RateAnimeDto) {
    return this.prisma.$transaction(async (tx) => {
      const anime = await tx.anime.findUnique({
        where: { slug: animeSlug },
        select: { id: true },
      });

      if (!anime) {
        throw new NotFoundException('Anime não encontrado.');
      }

      // Serializa recomputes concorrentes: sem o lock, o snapshot do AVG
      // pode perder um voto commitado entre o upsert e o UPDATE (F1).
      await tx.$executeRaw`SELECT 1 FROM "Anime" WHERE "id" = ${anime.id} FOR UPDATE`;

      const rating = await tx.rating.upsert({
        where: {
          userId_animeId: { userId, animeId: anime.id },
        },
        update: { score: dto.score },
        create: { userId, animeId: anime.id, score: dto.score },
      });

      await this.recomputeAnimeRating(tx, anime.id);

      return rating;
    });
  }

  async remove(userId: string, animeSlug: string) {
    return this.prisma.$transaction(async (tx) => {
      const anime = await tx.anime.findUnique({
        where: { slug: animeSlug },
        select: { id: true },
      });

      if (!anime) {
        throw new NotFoundException('Anime não encontrado.');
      }

      await tx.$executeRaw`SELECT 1 FROM "Anime" WHERE "id" = ${anime.id} FOR UPDATE`;

      try {
        await tx.rating.delete({
          where: {
            userId_animeId: { userId, animeId: anime.id },
          },
        });
      } catch {
        throw new NotFoundException('Avaliação não encontrada.');
      }

      await this.recomputeAnimeRating(tx, anime.id);

      return { message: 'Avaliação removida.' };
    });
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

  /**
   * Chamada somente dentro de $transaction, após SELECT ... FOR UPDATE no
   * Anime: o lock garante que toda escrita concorrente já comitou antes do
   * aggregate — o valor persistido é exato, não apenas "último a vencer".
   */
  private async recomputeAnimeRating(
    tx: Prisma.TransactionClient,
    animeId: string,
  ) {
    const { _avg } = await tx.rating.aggregate({
      where: { animeId },
      _avg: { score: true },
    });
    await tx.anime.update({
      where: { id: animeId },
      data: { rating: _avg.score ?? 0 },
    });
  }
}
