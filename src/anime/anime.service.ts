import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, AnimeFormat, AnimeSeason, AudioType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  parsePageParam,
} from '@/common/constants';

export type SortMode = 'recentlyAdded' | 'rating' | 'views' | 'year' | 'title';

export interface AnimeFilterDto {
  page?: string;
  limit?: string;
  search?: string;
  genres?: string;
  status?: string;
  audio?: string;
  format?: string;
  year?: string;
  season?: string;
  ageRating?: string;
  minScore?: string;
  maxScore?: string;
  sort?: string;
  published?: string;
}

function buildWhere(filters: AnimeFilterDto): Prisma.AnimeWhereInput {
  const where: Prisma.AnimeWhereInput = {};

  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { japaneseTitle: { contains: filters.search, mode: 'insensitive' } },
      { slug: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  if (filters.genres) {
    const genreSlugs = filters.genres
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (genreSlugs.length) {
      where.genres = { some: { slug: { in: genreSlugs } } };
    }
  }

  if (filters.status) where.status = filters.status;
  if (filters.audio) where.audio = filters.audio as AudioType;
  if (filters.format) where.format = filters.format as AnimeFormat;
  if (filters.year) where.year = parseInt(filters.year, 10);
  if (filters.season) where.season = filters.season as AnimeSeason;
  if (filters.ageRating) where.ageRating = filters.ageRating;

  if (filters.minScore || filters.maxScore) {
    where.rating = {};
    if (filters.minScore) where.rating.gte = parseFloat(filters.minScore);
    if (filters.maxScore) where.rating.lte = parseFloat(filters.maxScore);
  }

  if (filters.published !== undefined) {
    where.published = filters.published !== 'false';
  } else {
    where.published = true;
  }

  return where;
}

function buildOrderBy(
  sort: string | undefined,
): Prisma.AnimeOrderByWithRelationInput {
  switch (sort as SortMode | undefined) {
    case 'recentlyAdded':
      return { createdAt: 'desc' };
    case 'views':
      return { episodes: { _count: 'desc' } };
    case 'year':
      return { year: 'desc' };
    case 'title':
      return { title: 'asc' };
    case 'rating':
    default:
      return { rating: 'desc' };
  }
}

@Injectable()
export class AnimeService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: AnimeFilterDto) {
    const pageNumber = parsePageParam(filters.page, DEFAULT_PAGE);
    const limitNumber = parsePageParam(filters.limit, DEFAULT_PAGE_SIZE);
    const skip = (pageNumber - 1) * limitNumber;
    const where = buildWhere(filters);
    const orderBy = buildOrderBy(filters.sort);

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
        animeSchedules: true,
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

  async findRelated(slug: string, limit = 6) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
      include: { genres: { select: { id: true } } },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const genreIds = anime.genres.map((g) => g.id);
    if (genreIds.length === 0) return [];

    const related = await this.prisma.anime.findMany({
      where: {
        id: { not: anime.id },
        published: true,
        genres: { some: { id: { in: genreIds } } },
      },
      take: Math.min(limit, 12),
      orderBy: { rating: 'desc' },
      include: { genres: true },
    });

    return related;
  }

  async findStats(slug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const [favoriteCount, ratingAgg, ratingCount] =
      await this.prisma.$transaction([
        this.prisma.favorite.count({ where: { animeId: anime.id } }),
        this.prisma.rating.aggregate({
          where: { animeId: anime.id },
          _avg: { score: true },
          _min: { score: true },
          _max: { score: true },
        }),
        this.prisma.rating.count({ where: { animeId: anime.id } }),
      ]);

    return {
      favorites: favoriteCount,
      ratingAverage: ratingAgg._avg.score ?? null,
      ratingCount,
      ratingMin: ratingAgg._min.score ?? null,
      ratingMax: ratingAgg._max.score ?? null,
    };
  }

  async findRandom() {
    const count = await this.prisma.anime.count({ where: { published: true } });
    if (count === 0) return null;

    const skip = Math.floor(Math.random() * count);
    const [anime] = await this.prisma.anime.findMany({
      where: { published: true },
      skip,
      take: 1,
      include: { genres: true },
    });
    return anime ?? null;
  }

  async findTop(limit = 20) {
    return this.prisma.anime.findMany({
      where: { published: true },
      orderBy: { rating: 'desc' },
      take: Math.min(limit, 100),
      include: { genres: true },
    });
  }

  async findTrending(limit = 20, sinceDays = 7) {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);

    const episodes = await this.prisma.episode.findMany({
      where: { dateModified: { gte: since } },
      select: { animeId: true, views: true },
    });

    const viewsByAnime = new Map<string, number>();
    for (const ep of episodes) {
      viewsByAnime.set(
        ep.animeId,
        (viewsByAnime.get(ep.animeId) ?? 0) + ep.views,
      );
    }

    const ranked = [...viewsByAnime.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

    if (ranked.length === 0) {
      return this.findTop(limit);
    }

    const animes = await this.prisma.anime.findMany({
      where: { id: { in: ranked }, published: true },
      include: { genres: true },
    });

    return ranked
      .map((id) => animes.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }

  async findRecentlyAdded(limit = 20) {
    return this.prisma.anime.findMany({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: { genres: true },
    });
  }

  async findCalendar(season?: string, year?: string) {
    const where: Prisma.AnimeWhereInput = { published: true };
    if (year) where.year = parseInt(year, 10);
    if (season) where.season = season as AnimeSeason;

    const animes = await this.prisma.anime.findMany({
      where,
      orderBy: [{ year: 'desc' }, { title: 'asc' }],
      include: {
        genres: true,
        animeSchedules: true,
      },
    });

    const byDay: Record<number, typeof animes> = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };
    const unscheduled: typeof animes = [];

    for (const anime of animes) {
      if (anime.animeSchedules.length > 0) {
        for (const sched of anime.animeSchedules) {
          if (sched.dayOfWeek >= 0 && sched.dayOfWeek <= 6) {
            byDay[sched.dayOfWeek]!.push(anime);
          }
        }
      } else {
        unscheduled.push(anime);
      }
    }

    return {
      byDay: [
        { day: 0, label: 'Domingo', animes: byDay[0] },
        { day: 1, label: 'Segunda', animes: byDay[1] },
        { day: 2, label: 'Terça', animes: byDay[2] },
        { day: 3, label: 'Quarta', animes: byDay[3] },
        { day: 4, label: 'Quinta', animes: byDay[4] },
        { day: 5, label: 'Sexta', animes: byDay[5] },
        { day: 6, label: 'Sábado', animes: byDay[6] },
      ],
      unscheduled,
    };
  }
}
