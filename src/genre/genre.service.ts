import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  parsePageParam,
} from '@/common/constants';

@Injectable()
export class GenreService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const genres = await this.prisma.genre.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { animes: true } } },
    });
    return genres;
  }

  async findBySlug(slug: string) {
    const genre = await this.prisma.genre.findUnique({
      where: { slug },
    });

    if (!genre) {
      throw new NotFoundException('Gênero não encontrado.');
    }

    return genre;
  }

  async findAnimesBySlug(
    slug: string,
    page: string | undefined,
    limit: string | undefined,
  ) {
    const genre = await this.prisma.genre.findUnique({
      where: { slug },
      select: { id: true, name: true },
    });

    if (!genre) {
      throw new NotFoundException('Gênero não encontrado.');
    }

    const pageNumber = parsePageParam(page, DEFAULT_PAGE);
    const limitNumber = parsePageParam(limit, DEFAULT_PAGE_SIZE);
    const skip = (pageNumber - 1) * limitNumber;

    const where = {
      published: true,
      genres: { some: { slug } },
    };

    const [animes, total] = await this.prisma.$transaction([
      this.prisma.anime.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy: { rating: 'desc' },
        include: { genres: true },
      }),
      this.prisma.anime.count({ where }),
    ]);

    return {
      genre: { id: genre.id, name: genre.name, slug },
      data: animes,
      meta: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }
}
