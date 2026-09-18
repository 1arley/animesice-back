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
    const match = url.pathname.match(/(?:anime|manga)\/(\d+)/i);
    if (!match || !['myanimelist.net', 'anilist.co'].includes(host)) {
      throw new NotFoundException(
        'URL externa deve ser MAL ou AniList com ID.',
      );
    }

    const externalSource = host === 'myanimelist.net' ? 'MAL' : 'ANILIST';
    const externalId = Number(match[1]);
    const existing = await this.prisma.anime.findFirst({
      where: {
        OR: [
          { externalSource, externalUrl: dto.url },
          ...(externalSource === 'MAL'
            ? [{ malId: externalId }]
            : [{ anilistId: externalId }]),
        ],
      },
    });
    if (existing) return existing;

    let title = dto.title?.trim();
    let coverImage = dto.coverImage?.trim();
    if (externalSource === 'MAL' && !title && process.env.MAL_CLIENT_ID) {
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
    if (!title)
      throw new NotFoundException('Não foi possível obter título da obra.');

    const slug = await this.uniqueSlug(this.slugify(title));
    return this.prisma.anime.create({
      data: {
        slug,
        title,
        coverImage,
        source: 'MANGA',
        externalUrl: dto.url,
        externalSource,
        malId: externalSource === 'MAL' ? externalId : undefined,
        anilistId: externalSource === 'ANILIST' ? externalId : undefined,
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

  async listAnimesForAdmin(page = 1, limit = 50, search?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.AnimeWhereInput = {};
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { japaneseTitle: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [animes, total] = await this.prisma.$transaction([
      this.prisma.anime.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { genres: true, _count: { select: { episodes: true } } },
      }),
      this.prisma.anime.count({ where }),
    ]);
    return {
      data: animes,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
