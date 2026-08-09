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
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
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
        genres: genreSlugs?.length
          ? { connect: genreSlugs.map((slug) => ({ slug })) }
          : undefined,
      },
      include: { genres: true },
    });
  }

  async updateAnime(slug: string, dto: UpdateAnimeDto) {
    const anime = await this.prisma.anime.findUnique({ where: { slug } });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const { genreSlugs, ...fields } = dto;
    const data: Prisma.AnimeUpdateInput = { ...fields };
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
    const anime = await this.prisma.anime.findUnique({ where: { slug } });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
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
    const episode = await this.prisma.episode.create({
      data: { ...dto, animeId: anime.id },
    });

    void this.notificationService.notifyNewEpisode(
      anime.id,
      anime.title,
      episode.number,
      anime.slug,
    );

    return episode;
  }

  async updateEpisode(slug: string, number: number, dto: UpdateEpisodeDto) {
    const anime = await this.prisma.anime.findUnique({ where: { slug } });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }
    const episode = await this.prisma.episode.findUnique({
      where: { animeId_number: { animeId: anime.id, number } },
    });
    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }
    return this.prisma.episode.update({
      where: { id: episode.id },
      data: dto,
    });
  }

  async deleteEpisode(slug: string, number: number) {
    const anime = await this.prisma.anime.findUnique({ where: { slug } });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }
    const episode = await this.prisma.episode.findUnique({
      where: { animeId_number: { animeId: anime.id, number } },
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
        typeof media.averageScore === 'number' ? media.averageScore : undefined,
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
    };

    const anime = await this.createAnime(createDto);

    return {
      ...anime,
      anilistId: media.id,
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
