import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { CreateAnimeDto, UpdateAnimeDto } from '@/admin/dto/update-anime.dto';
import {
  CreateEpisodeDto,
  UpdateEpisodeDto,
} from '@/admin/dto/update-episode.dto';
import { CreateGenreDto } from '@/admin/dto/create-genre.dto';
import { AniListService, AniListMedia } from '@/admin/anilist.service';
import { ImportAnimeDto } from '@/admin/dto/import-anime.dto';
import { AnimeFormat, AnimeSeason, AudioType } from '@prisma/client';
import { audioTypeFromTitle } from '@/common/anime-audio';
import { CreateExternalAnimeDto } from '@/admin/dto/create-external-anime.dto';

/** Candidatos lidos antes do ranking por relevância na busca de animes. */
const ANIME_SEARCH_WINDOW = 200;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anilistService: AniListService,
    private readonly notificationService: NotificationService,
  ) {}

  // --- Helpers ------------------------------------------------------------

  /** Remove HTML/scripts de texto vindo de fontes externas (anti-XSS). */
  private stripHtml(input: string | null | undefined): string | undefined {
    if (!input) return undefined;
    return input
      .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, ' ')
      .replace(/<|>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private slugify(input: string): string {
    return (
      input
        .toString()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|(?<!-)-+$/g, '')
        .replace(/-{2,}/g, '-')
        .slice(0, 80) || 'anime'
    );
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    let n = 2;
    while (
      await this.prisma.anime.findUnique({
        where: { slug },
        select: { id: true },
      })
    ) {
      slug = `${base}-${n}`;
      n += 1;
    }
    return slug;
  }

  /**
   * Normaliza texto para busca tolerante a acentos e tipografia — o catálogo
   * real tem títulos como "PokéOki", "Arbeit Shiyou!! Let’s Arbeit!" e
   * "2×1", que o ILIKE puro não casa quando o admin digita sem acento.
   */
  private foldForSearch(input: string | null | undefined): string {
    return (input ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[’‘`´]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/[×✕✖]/g, 'x')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Pontuação de relevância: menor é melhor. O catálogo guarda variantes
   * ("… Dublado", "… 2", "… – Hashira Geiko-hen") como animes separados, então
   * ordenar só por `createdAt` escondia o título exato atrás de 10 linhas
   * parecidas — o sintoma clássico de "o anime não aparece na busca".
   */
  private animeRelevance(
    term: string,
    anime: {
      title: string;
      japaneseTitle: string | null;
      slug: string | null;
      alternativeTitles: string[];
    },
  ): number {
    let best = Number.MAX_SAFE_INTEGER;
    const consider = (value: string | null | undefined) => {
      if (!value) return;
      const folded = this.foldForSearch(value);
      if (folded === term) best = Math.min(best, 0);
      else if (folded.startsWith(term)) best = Math.min(best, 1);
      else if (folded.split(' ').some((word) => word.startsWith(term)))
        best = Math.min(best, 2);
      else if (folded.includes(term)) best = Math.min(best, 3);
    };
    consider(anime.title);
    consider(anime.japaneseTitle);
    for (const alt of anime.alternativeTitles ?? []) consider(alt);
    // slug é ASCII puro: cobre a busca sem acento ("pokeoki" → "PokéOki").
    if (anime.slug?.includes(term)) best = Math.min(best, 4);
    return best;
  }

  // --- Anime -------------------------------------------------------------

  async createAnime(dto: CreateAnimeDto) {
    const existing = await this.prisma.anime.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException('Slug já existe.');
    }

    const { genreSlugs, ...animeFields } = dto;
    return this.prisma.anime.create({
      data: {
        ...animeFields,
        audio: audioTypeFromTitle(dto.title),
        genres: genreSlugs?.length
          ? { connect: genreSlugs.map((slug) => ({ slug })) }
          : undefined,
      },
      include: { genres: true },
    });
  }

  async createExternalAnime(dto: CreateExternalAnimeDto) {
    const url = new URL(dto.url);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    // Detect known sources (MAL / AniList) for auto-fetch; all other hosts are
    // accepted as generic external sources.
    const malMatch =
      host === 'myanimelist.net'
        ? url.pathname.match(/(?:anime|manga)\/(\d+)/i)
        : null;
    const anilistMatch =
      host === 'anilist.co'
        ? url.pathname.match(/(?:anime|manga)\/(\d+)/i)
        : null;

    const isMAL = malMatch !== null;
    const isAniList = anilistMatch !== null;
    const externalId = isMAL
      ? Number(malMatch[1])
      : isAniList
        ? Number(anilistMatch[1])
        : null;

    // Derive a short source label: MAL, ANILIST, or the bare hostname.
    const externalSource = isMAL ? 'MAL' : isAniList ? 'ANILIST' : host;

    // Deduplicate: for MAL/AniList match by numeric ID; for others match by URL.
    const existing = await this.prisma.anime.findFirst({
      where: {
        OR: [
          { externalSource, externalUrl: dto.url },
          ...(isMAL && externalId !== null ? [{ malId: externalId }] : []),
          ...(isAniList && externalId !== null
            ? [{ anilistId: externalId }]
            : []),
        ],
      },
    });
    if (existing) return existing;

    let title = dto.title?.trim();
    let coverImage = dto.coverImage?.trim();

    // Auto-fetch title/cover from MAL API when possible.
    if (isMAL && externalId !== null && !title && process.env.MAL_CLIENT_ID) {
      const response = await fetch(
        `https://api.myanimelist.net/v2/manga/${externalId}?fields=title,main_picture`,
        { headers: { 'X-MAL-CLIENT-ID': process.env.MAL_CLIENT_ID } },
      );
      if (response.ok) {
        const payload = (await response.json()) as {
          title?: string;
          main_picture?: { large?: string; medium?: string };
        };
        title = payload.title;
        coverImage =
          coverImage ||
          payload.main_picture?.large ||
          payload.main_picture?.medium;
      }
    }

    // For generic sources, title is mandatory because there is no auto-fetch.
    if (!title)
      throw new NotFoundException(
        'Título obrigatório para fontes externas que não sejam MAL ou AniList.',
      );

    const slug = await this.uniqueSlug(this.slugify(title));
    return this.prisma.anime.create({
      data: {
        slug,
        title,
        coverImage,
        source: 'MANGA',
        externalUrl: dto.url,
        externalSource,
        malId: isMAL && externalId !== null ? externalId : undefined,
        anilistId: isAniList && externalId !== null ? externalId : undefined,
        published: false,
        status: 'FINALIZADO',
        audio: AudioType.LEGENDADO,
      },
    });
  }

  async getAnimeForAdmin(slug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
      include: { genres: true, _count: { select: { episodes: true } } },
    });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }
    return anime;
  }

  async updateAnime(slug: string, dto: UpdateAnimeDto) {
    const anime = await this.prisma.anime.findUnique({ where: { slug } });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const { genreSlugs, ...fields } = dto;
    // Convert empty strings to null for clearable optional fields so Prisma
    // actually writes the removal instead of skipping the field entirely.
    const CLEARABLE = [
      'synopsis',
      'posterImage',
      'coverImage',
      'trailerUrl',
      'embedUrl',
      'rating',
      'notes',
    ] as const;
    const data: Prisma.AnimeUpdateInput = {
      ...Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          CLEARABLE.includes(k as (typeof CLEARABLE)[number]) && v === ''
            ? null
            : v,
        ]),
      ),
      audio: audioTypeFromTitle(dto.title ?? anime.title),
    };
    if (genreSlugs !== undefined) {
      data.genres = { set: genreSlugs.map((slug) => ({ slug })) };
    }

    return this.prisma.anime.update({
      where: { slug },
      data,
      include: { genres: true },
    });
  }

  async deleteAnime(slug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
      include: { _count: { select: { cards: true } } },
    });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }
    if (anime._count?.cards > 0) {
      throw new ConflictException('Anime possui cartas vinculadas.');
    }
    await this.prisma.anime.delete({ where: { slug } });
    return { message: 'Anime removido.' };
  }

  // --- Episode ------------------------------------------------------------

  async createEpisode(slug: string, dto: CreateEpisodeDto) {
    const anime = await this.prisma.anime.findUnique({ where: { slug } });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }
    const { season, ...rest } = dto;
    const episode = await this.prisma.episode.create({
      data: { ...rest, season: season ?? 1, animeId: anime.id },
    });

    void this.notificationService
      .notifyNewEpisode(anime.id, anime.title, episode.number, anime.slug)
      .catch(() => undefined);

    return episode;
  }

  async updateEpisode(
    slug: string,
    number: number,
    dto: UpdateEpisodeDto,
    season: number = 1,
  ) {
    const anime = await this.prisma.anime.findUnique({ where: { slug } });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }
    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: { animeId: anime.id, season, number },
      },
    });
    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }
    const CLEARABLE_EP = [
      'title',
      'videoUrl',
      'thumbnail',
      'duration',
    ] as const;
    const data: Prisma.EpisodeUpdateInput = Object.fromEntries(
      Object.entries(dto).map(([k, v]) => [
        k,
        CLEARABLE_EP.includes(k as (typeof CLEARABLE_EP)[number]) && v === ''
          ? null
          : v,
      ]),
    );
    return this.prisma.episode.update({
      where: { id: episode.id },
      data,
    });
  }

  async deleteEpisode(slug: string, number: number, season: number = 1) {
    const anime = await this.prisma.anime.findUnique({ where: { slug } });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }
    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: { animeId: anime.id, season, number },
      },
    });
    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }
    await this.prisma.episode.delete({ where: { id: episode.id } });
    return { message: 'Episódio removido.' };
  }

  // --- Genre --------------------------------------------------------------

  async createGenre(dto: CreateGenreDto) {
    const existing = await this.prisma.genre.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException('Gênero já existe.');
    }
    return this.prisma.genre.create({ data: dto });
  }

  // --- Import AniList -----------------------------------------------------

  async importFromAniList(dto: ImportAnimeDto) {
    if (dto.anilistId == null && !dto.search) {
      throw new NotFoundException('Informe anilistId ou search.');
    }

    const media: AniListMedia =
      dto.anilistId != null
        ? await this.anilistService.fetchMedia(dto.anilistId)
        : await this.anilistService.searchMedia(dto.search as string);

    const title =
      media.title?.romaji || media.title?.english || media.title?.native || '';
    if (!title) {
      throw new NotFoundException('AniList retornou mídia sem título.');
    }

    const baseSlug = this.slugify(
      media.title?.romaji || media.title?.native || title,
    );
    const slug = await this.uniqueSlug(baseSlug);

    const genreNames = (media.genres ?? []).filter((g): g is string => !!g);
    const genreSlugs = genreNames.map((g) => this.slugify(g));

    // Cria gêneros faltantes antes do connect --------------------------
    if (genreSlugs.length) {
      await Promise.all(
        genreSlugs.map((gSlug, i) =>
          this.prisma.genre.upsert({
            where: { slug: gSlug },
            update: {},
            create: { slug: gSlug, name: genreNames[i] || gSlug },
          }),
        ),
      );
    }

    // Mapeia season string → enum -------------------------------------
    const seasonMap: Record<string, AnimeSeason> = {
      WINTER: AnimeSeason.WINTER,
      SPRING: AnimeSeason.SPRING,
      SUMMER: AnimeSeason.SUMMER,
      FALL: AnimeSeason.FALL,
    };
    const season = media.season ? seasonMap[media.season] : undefined;

    // Mapeia format string → enum --------------------------------------
    const formatMap: Record<string, AnimeFormat> = {
      TV: AnimeFormat.TV,
      MOVIE: AnimeFormat.MOVIE,
      OVA: AnimeFormat.OVA,
      ONA: AnimeFormat.ONA,
      SPECIAL: AnimeFormat.SPECIAL,
      MUSIC: AnimeFormat.MUSIC,
    };
    const format = media.format ? formatMap[media.format] : undefined;

    // Mapeia AniList status → status interno ---------------------------
    // FINISHED / CANCELLED → FINALIZADO | NOT_YET_RELEASED → EM_BREVE
    // RELEASING / HIATUS → LANCAMENTO
    const statusMap: Record<string, string> = {
      FINISHED: 'FINALIZADO',
      CANCELLED: 'FINALIZADO',
      NOT_YET_RELEASED: 'EM_BREVE',
      RELEASING: 'LANCAMENTO',
      HIATUS: 'LANCAMENTO',
    };
    const mappedStatus = media.status ? statusMap[media.status] : undefined;

    // Estúdios de animação ----------------------------------------------
    const studios = (media.studios?.nodes ?? [])
      .filter((s) => s.isAnimationStudio !== false)
      .map((s) => s.name);

    // Datas de estreia/fim ---------------------------------------------
    const releaseDate = media.startDate?.year
      ? new Date(
          media.startDate.year,
          (media.startDate.month ?? 1) - 1,
          media.startDate.day ?? 1,
        )
      : undefined;
    const endDate = media.endDate?.year
      ? new Date(
          media.endDate.year,
          (media.endDate.month ?? 1) - 1,
          media.endDate.day ?? 1,
        )
      : undefined;

    // Títulos alternativos ---------------------------------------------
    const alternativeTitles = [
      media.title?.english,
      media.title?.native,
    ].filter((t): t is string => !!t && t !== title);

    const createDto: CreateAnimeDto = {
      slug,
      title,
      synopsis: this.stripHtml(media.description),
      coverImage:
        media.coverImage?.large ?? media.coverImage?.extraLarge ?? undefined,
      bannerImage: media.bannerImage ?? undefined,
      rating:
        typeof media.averageScore === 'number'
          ? media.averageScore / 10
          : undefined,
      status: mappedStatus ?? 'LANCAMENTO',
      audio: dto.audio ?? AudioType.LEGENDADO,
      ageRating: media.isAdult ? 'A18' : 'A14',
      genreSlugs,
      ...(format ? { format } : {}),
      ...(media.seasonYear ? { year: media.seasonYear } : {}),
      ...(season ? { season } : {}),
      ...(studios.length ? { studios } : {}),
      ...(alternativeTitles.length ? { alternativeTitles } : {}),
      ...(media.title?.native ? { japaneseTitle: media.title.native } : {}),
      ...(media.source ? { source: media.source } : {}),
      ...(releaseDate ? { releaseDate: releaseDate.toISOString() } : {}),
      ...(endDate ? { endDate: endDate.toISOString() } : {}),
      ...(media.episodes ? { episodeCount: media.episodes } : {}),
      published: true,
      anilistId: media.id,
    };

    const anime = await this.createAnime(createDto);

    return {
      ...anime,
      anilistUrl: `https://anilist.co/anime/${media.id}`,
    };
  }

  // --- Admin overview -----------------------------------------------------

  /**
   * Lista animes para o admin. Com `search`, ordena por relevância (título
   * exato → prefixo → palavra → conteúdo) em vez de `createdAt`, para que o
   * anime procurado apareça no topo do typeahead. `counts: false` omite
   * `genres`/`_count.episodes` — usado pelo autocomplete, que não precisa deles.
   */
  async listAnimesForAdmin(
    page = 1,
    limit = 50,
    search?: string,
    options: { counts?: boolean } = {},
  ) {
    const include =
      options.counts === false
        ? undefined
        : { genres: true, _count: { select: { episodes: true } } };
    const term = this.foldForSearch(search);
    const where: Prisma.AnimeWhereInput = {};

    if (term) {
      const clauses: Prisma.AnimeWhereInput[] = [
        { title: { contains: term, mode: 'insensitive' } },
        { japaneseTitle: { contains: term, mode: 'insensitive' } },
        // slug é ASCII puro: é o que faz "pokeoki" achar "PokéOki".
        { slug: { contains: term, mode: 'insensitive' } },
        // `has` é igualdade de elemento em text[]; busca parcial dentro do
        // array exigiria raw SQL, então mantemos o título alternativo exato.
        { alternativeTitles: { has: search?.trim() ?? term } },
      ];
      if (/^\d+$/.test(term)) {
        const externalId = Number(term);
        clauses.push({ malId: externalId }, { anilistId: externalId });
      }
      where.OR = clauses;
    }

    if (!term) {
      const [animes, total] = await this.prisma.$transaction([
        this.prisma.anime.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          ...(include ? { include } : {}),
        }),
        this.prisma.anime.count({ where }),
      ]);
      return {
        data: animes,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    // Janela de candidatos: o ranking é feito em JS para pontuar o título exato,
    // então buscamos uma margem e ordenamos por relevância antes de paginar.
    const candidates = await this.prisma.anime.findMany({
      where,
      take: ANIME_SEARCH_WINDOW,
      orderBy: { createdAt: 'desc' },
      ...(include ? { include } : {}),
    });
    const ranked = candidates
      .map((anime) => ({ anime, rank: this.animeRelevance(term, anime) }))
      .filter((row) => row.rank < Number.MAX_SAFE_INTEGER)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          a.anime.title.length - b.anime.title.length ||
          a.anime.title.localeCompare(b.anime.title, 'pt-BR'),
      );
    const total = ranked.length;
    const start = (page - 1) * limit;
    return {
      data: ranked.slice(start, start + limit).map((row) => row.anime),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
