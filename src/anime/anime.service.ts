import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, AnimeFormat, AnimeSeason, AudioType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  parsePageParam,
} from '@/common/constants';

/** Limiar de similaridade p/ entrar na busca fuzzy (0–1) — pg_trgm. */
const FUZZY_THRESHOLD = Number(process.env.SEARCH_FUZZY_THRESHOLD ?? 0.35);
/** Query menor que isso usa a busca contains atual (fuzzy é ruído p/ strings curtas). */
const FUZZY_MIN_QUERY_LENGTH = 3;
/** Teto de candidatos retornados pelo ranking fuzzy. */
const FUZZY_MAX_CANDIDATES = 500;

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

    // Busca fuzzy (pg_trgm): ranking por similaridade (tolera typos e ordem
    // de palavras) com fallback p/ o contains atual quando a extensão não
    // existe ou nada passa do limiar. Nunca quebra a busca — degrada.
    // Pontuação vira espaço antes de tokenizar ("one-piece" vira "one piece");
    // letras/acentos/japonês (\p{L}) são preservados.
    const query = filters.search
      ?.trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim();
    let fuzzyIds: string[] | null = null;
    if (query && query.length >= FUZZY_MIN_QUERY_LENGTH) {
      try {
        fuzzyIds = await this.fuzzyRankedIds(query);
      } catch (err) {
        console.error(
          '[SEARCH] fuzzy indisponível, usando contains:',
          err instanceof Error ? err.message : String(err),
        );
        fuzzyIds = null;
      }
    }

    // Sem sort explícito, a relevância fuzzy é a ordenação primária. Pagina
    // sobre a lista rankeada (candidatos ∩ demais filtros) preservando a
    // ordem de relevância — antes buscava 1 página por rating e só então
    // reordenava, deixando o match exato (ex.: "Spy x Family") sumir na
    // página 2 quando havia muitos candidatos com score empatado.
    if (fuzzyIds && fuzzyIds.length > 0 && !filters.sort) {
      const { OR: _searchOr, ...baseWhere } = where;
      const filteredIds = await this.prisma.anime.findMany({
        where: { ...baseWhere, id: { in: fuzzyIds } },
        select: { id: true },
      });
      const filteredSet = new Set(filteredIds.map((a) => a.id));
      const ranked = fuzzyIds.filter((id) => filteredSet.has(id));
      const total = ranked.length;
      const pageIds = ranked.slice(skip, skip + limitNumber);

      const animes = pageIds.length
        ? await this.prisma.anime.findMany({
            where: { id: { in: pageIds } },
            include: { genres: true },
          })
        : [];
      const byId = new Map(animes.map((a) => [a.id, a]));
      const data = pageIds
        .map((id) => byId.get(id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a));

      return {
        data,
        meta: {
          total,
          page: pageNumber,
          limit: limitNumber,
          totalPages: Math.ceil(total / limitNumber),
        },
      };
    }

    if (fuzzyIds && fuzzyIds.length > 0) {
      where.id = { in: fuzzyIds };
      delete where.OR; // a fuzzy substitui o OR contains (recall maior)
    }

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

  /**
   * Ranking fuzzy via pg_trgm (word_similarity): a query é tokenizada em
   * palavras e cada palavra é comparada com a MELHOR palavra do título
   * (title/japaneseTitle/alternativeTitles, minúsculas). Isso tolera typos
   * dentro de palavras ("kagua" → Kaguya) e ordem diferente das palavras
   * ("love war kaguya"), onde o similarity() de string inteira falharia
   * (o union de trigramas é dominado pelo título longo).
   *
   * Só candidatos com ao menos uma palavra acima do limiar entram (recall),
   * mas a ordem é por SOMA das similaridades: quem casa TODAS as palavras
   * ("Spy x Family") fica à frente de quem casa só uma ("Triage X" no x).
   * No empate, o similarity() da query inteira desempata — o título exato
   * ("Spy x Family") vence das variantes ("Spy x Family Dublado").
   */
  private async fuzzyRankedIds(query: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM (
        SELECT a.id,
          GREATEST(
            word_similarity(w, LOWER(a.title)),
            COALESCE(word_similarity(w, LOWER(a."japaneseTitle")), 0),
            COALESCE(word_similarity(w, LOWER(array_to_string(a."alternativeTitles", ' '))), 0)
          ) AS ws,
          GREATEST(
            similarity(${query}, LOWER(a.title)),
            COALESCE(similarity(${query}, LOWER(array_to_string(a."alternativeTitles", ' '))), 0)
          ) AS full_sim
        FROM "Anime" a
        CROSS JOIN LATERAL unnest(string_to_array(LOWER(${query}), ' ')) AS w
        WHERE a.published = true
      ) t
      GROUP BY t.id
      HAVING MAX(t.ws) > ${FUZZY_THRESHOLD}
      ORDER BY SUM(t.ws) DESC, MAX(t.full_sim) DESC, MAX(t.ws) DESC
      LIMIT ${FUZZY_MAX_CANDIDATES}
    `;
    return rows.map((r) => r.id);
  }

  async findBySlug(slug: string) {
    const anime = await this.prisma.anime.findFirst({
      where: { slug, published: true },
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
    const anime = await this.prisma.anime.findFirst({
      where: { slug, published: true },
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
        { day: 0, label: 'Domingo', animes: byDay[0]! },
        { day: 1, label: 'Segunda', animes: byDay[1]! },
        { day: 2, label: 'Terça', animes: byDay[2]! },
        { day: 3, label: 'Quarta', animes: byDay[3]! },
        { day: 4, label: 'Quinta', animes: byDay[4]! },
        { day: 5, label: 'Sexta', animes: byDay[5]! },
        { day: 6, label: 'Sábado', animes: byDay[6]! },
      ],
      unscheduled,
    };
  }
}
