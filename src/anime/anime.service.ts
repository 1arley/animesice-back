import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  parsePageParam,
} from '@/common/constants';

@Injectable()
export class AnimeService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page: string, limit: string, search?: string) {
    const pageNumber = parsePageParam(page, DEFAULT_PAGE);
    const limitNumber = parsePageParam(limit, DEFAULT_PAGE_SIZE);
    const skip = (pageNumber - 1) * limitNumber;
    const orderBy = { rating: 'desc' as const };

    const where = search
      ? { title: { contains: search, mode: 'insensitive' as const } }
      : {};

    const [animes, total] = await this.prisma.$transaction([
      this.prisma.anime.findMany({
        skip,
        take: limitNumber,
        orderBy,
        where,
        include: { genres: true },
      }),
      this.prisma.anime.count({ where }),
    ]);

    return {
      data: animes,
      meta: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  async findBySlug(slug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
      include: {
        genres: true,
        episodes: { orderBy: { number: 'asc' } },
      },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    return anime;
  }

  async findEpisodesBySlug(slug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
      include: {
        episodes: {
          orderBy: { number: 'desc' },
        },
      },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    return anime.episodes;
  }
}
