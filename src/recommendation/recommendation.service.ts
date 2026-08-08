import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class RecommendationService {
  constructor(private readonly prisma: PrismaService) {}

  async getPersonalized(userId: string, limit = 20) {
    const [ratedAnimes, listedAnimes, watchedAnimes] = await Promise.all([
      this.prisma.rating.findMany({
        where: { userId, score: { gte: 7 } },
        select: {
          anime: { select: { genres: { select: { id: true, slug: true } } } },
        },
      }),
      this.prisma.userAnimeList.findMany({
        where: { userId, status: { in: ['WATCHING', 'COMPLETED'] } },
        select: {
          anime: { select: { genres: { select: { id: true, slug: true } } } },
        },
      }),
      this.prisma.watchHistory.findMany({
        where: { userId, completed: true },
        select: {
          episode: {
            select: {
              anime: {
                select: { genres: { select: { id: true, slug: true } } },
              },
            },
          },
        },
      }),
    ]);

    const genreWeights = new Map<string, number>();
    for (const r of ratedAnimes) {
      for (const g of r.anime.genres) {
        genreWeights.set(g.id, (genreWeights.get(g.id) ?? 0) + 3);
      }
    }
    for (const l of listedAnimes) {
      for (const g of l.anime.genres) {
        genreWeights.set(g.id, (genreWeights.get(g.id) ?? 0) + 2);
      }
    }
    for (const w of watchedAnimes) {
      for (const g of w.episode.anime.genres) {
        genreWeights.set(g.id, (genreWeights.get(g.id) ?? 0) + 1);
      }
    }

    if (genreWeights.size === 0) {
      return this.prisma.anime.findMany({
        where: { published: true },
        orderBy: { rating: 'desc' },
        take: limit,
        include: { genres: true },
      });
    }

    const excludedAnimeIds = new Set<string>();
    const allListed = await this.prisma.userAnimeList.findMany({
      where: { userId },
      select: { animeId: true },
    });
    for (const l of allListed) excludedAnimeIds.add(l.animeId);

    const ratedAnimeIds = await this.prisma.rating.findMany({
      where: { userId },
      select: { animeId: true },
    });
    for (const r of ratedAnimeIds) excludedAnimeIds.add(r.animeId);

    const watchedAnimeIds = await this.prisma.watchHistory.findMany({
      where: { userId, completed: true },
      select: { episode: { select: { animeId: true } } },
    });
    for (const w of watchedAnimeIds) excludedAnimeIds.add(w.episode.animeId);

    const topGenreIds = [...genreWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    const candidates = await this.prisma.anime.findMany({
      where: {
        published: true,
        id: { notIn: [...excludedAnimeIds] },
        genres: { some: { id: { in: topGenreIds } } },
      },
      include: { genres: true },
      take: limit * 3,
      orderBy: { rating: 'desc' },
    });

    const scored = candidates.map((anime) => {
      let score = anime.rating ?? 0;
      for (const g of anime.genres) {
        score += genreWeights.get(g.id) ?? 0;
      }
      if (anime.year && anime.year >= new Date().getFullYear() - 2) {
        score += 1;
      }
      return { anime, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const seenGenres = new Set<string>();
    const diversified: typeof scored = [];
    const leftovers: typeof scored = [];

    for (const item of scored) {
      const genreIds = item.anime.genres.map((g) => g.id);
      const hasNewGenre = genreIds.some((id) => !seenGenres.has(id));
      if (hasNewGenre || diversified.length < limit / 2) {
        genreIds.forEach((id) => seenGenres.add(id));
        diversified.push(item);
      } else {
        leftovers.push(item);
      }
      if (diversified.length >= limit) break;
    }

    while (diversified.length < limit && leftovers.length > 0) {
      diversified.push(leftovers.shift()!);
    }

    return diversified.slice(0, limit).map((item) => item.anime);
  }

  async getSimilar(animeSlug: string, limit = 12) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true, genres: { select: { id: true } }, year: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const genreIds = anime.genres.map((g) => g.id);
    if (genreIds.length === 0) return [];

    const candidates = await this.prisma.anime.findMany({
      where: {
        id: { not: anime.id },
        published: true,
        genres: { some: { id: { in: genreIds } } },
      },
      include: { genres: true },
      take: limit * 2,
    });

    const scored = candidates.map((c) => {
      const overlap = c.genres.filter((g) => genreIds.includes(g.id)).length;
      const yearBonus =
        c.year && anime.year && Math.abs((c.year ?? 0) - (anime.year ?? 0)) <= 2
          ? 1
          : 0;
      return {
        anime: c,
        score: overlap * 2 + (c.rating ?? 0) / 10 + yearBonus,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s) => s.anime);
  }

  async getBecauseYouWatched(userId: string, limit = 12) {
    const watched = await this.prisma.watchHistory.findMany({
      where: { userId, completed: true },
      select: {
        episode: {
          select: {
            animeId: true,
            anime: { select: { genres: { select: { id: true } } } },
          },
        },
      },
      take: 50,
      orderBy: { watchedAt: 'desc' },
    });

    if (watched.length === 0) return [];

    const genreCount = new Map<string, number>();
    const watchedAnimeIds = new Set<string>();
    for (const w of watched) {
      watchedAnimeIds.add(w.episode.animeId);
      for (const g of w.episode.anime.genres) {
        genreCount.set(g.id, (genreCount.get(g.id) ?? 0) + 1);
      }
    }

    const topGenres = [...genreCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    const candidates = await this.prisma.anime.findMany({
      where: {
        published: true,
        id: { notIn: [...watchedAnimeIds] },
        genres: { some: { id: { in: topGenres } } },
      },
      include: { genres: true },
      take: limit,
      orderBy: { rating: 'desc' },
    });

    return candidates;
  }
}
