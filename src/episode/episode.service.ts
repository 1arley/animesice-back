import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class EpisodeService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAnimeSlug(slug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
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

  async findByAnimeSlugAndNumber(slug: string, number: number) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_number: {
          animeId: anime.id,
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

  async findLatest(limit: number = 12) {
    return this.prisma.episode.findMany({
      take: limit,
      where: { dateModified: { not: null } },
      orderBy: { dateModified: 'desc' },
      include: { anime: true },
    });
  }
}
