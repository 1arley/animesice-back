import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class EpisodeService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAnimeSlug(slug: string) {
    const anime = await this.prisma.anime.findFirst({
      where: { slug, published: true },
      include: { episodes: { orderBy: { number: 'asc' } } },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    return anime.episodes;
  }

  async findByAnimeSlugAndNumber(
    slug: string,
    number: number,
    season: number = 1,
  ) {
    const anime = await this.prisma.anime.findFirst({
      where: { slug, published: true },
      select: {
        id: true,
        episodes: {
          select: { number: true, season: true },
          orderBy: { number: 'asc' },
        },
      },
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

    // Injeta os números dos episódios no anime para o frontend evitar fetch extra
    (episode.anime as Record<string, unknown>).episodes = anime.episodes;

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

    await this.prisma.episode.updateMany({
      where: { animeId: anime.id, season, number },
      data: { views: { increment: 1 } },
    });

    return { message: 'View incrementada.' };
  }

  async findLatest(limit: number = 12) {
    return this.prisma.episode.findMany({
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: { anime: true },
    });
  }
}
