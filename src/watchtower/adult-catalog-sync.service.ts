import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaService } from '@/prisma/prisma.service';
import { ADULT_AGE_RATING, ADULT_GENRE_SLUG } from '@/common/adult';

const PAGE_SIZE = 100;

function syncEnabled(): boolean {
  return (
    process.env.ADULT_CATALOG_ENABLED === 'true' &&
    process.env.SITE_MODE !== 'hentai' &&
    Boolean(process.env.HENTAI_SOURCE_DATABASE_URL)
  );
}

@Injectable()
export class AdultCatalogSyncService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 4 * * *')
  async handleCron(): Promise<void> {
    if (!syncEnabled()) return;
    await this.sync().catch((e) => {
      console.error(
        '[ADULT-SYNC] falhou:',
        e instanceof Error ? e.message : String(e),
      );
    });
  }

  async sync(opts?: { dryRun?: boolean; limit?: number }) {
    const sourceUrl = process.env.HENTAI_SOURCE_DATABASE_URL || '';
    const source = new PrismaClient({
      adapter: new PrismaPg(new Pool({ connectionString: sourceUrl })),
    });
    let imported = 0;
    let updated = 0;
    try {
      await this.prisma.genre.upsert({
        where: { slug: ADULT_GENRE_SLUG },
        update: {},
        create: { slug: ADULT_GENRE_SLUG, name: 'Hentai' },
      });
      let skip = 0;
      for (;;) {
        const batch = await source.anime.findMany({
          where: { published: true },
          include: { genres: true, episodes: true },
          orderBy: { updatedAt: 'asc' },
          take: Math.min(PAGE_SIZE, (opts?.limit ?? PAGE_SIZE) - imported),
          skip,
        });
        if (batch.length === 0) break;
        for (const src of batch) {
          const res = await this.upsertOne(src, opts?.dryRun);
          if (res === 'created') imported += 1;
          else if (res === 'updated') updated += 1;
          if (opts?.limit && imported + updated >= opts.limit) break;
        }
        if (opts?.limit && imported + updated >= opts.limit) break;
        if (batch.length < PAGE_SIZE) break;
        skip += batch.length;
      }
    } finally {
      await source.$disconnect().catch(() => undefined);
    }
    return { imported, updated };
  }

  private async upsertOne(
    src: {
      slug: string;
      title: string;
      synopsis: string | null;
      coverImage: string | null;
      bannerImage: string | null;
      rating: number | null;
      status: string;
      audio: 'LEGENDADO' | 'DUBLADO';
      format: 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'MUSIC' | null;
      year: number | null;
      season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL' | null;
      studios: string[];
      themes: string[];
      alternativeTitles: string[];
      japaneseTitle: string | null;
      source: string | null;
      releaseDate: Date | null;
      endDate: Date | null;
      episodeCount: number | null;
      published: boolean;
      genres: Array<{ slug: string; name: string }>;
      episodes: Array<{
        season: number;
        number: number;
        title: string | null;
        thumbnailUrl: string | null;
        videoUrl: string | null;
        embedUrl: string | null;
        duration: string | null;
        sourceId: string | null;
      }>;
    },
    dryRun?: boolean,
  ): Promise<'created' | 'updated' | 'skipped'> {
    let slug = src.slug;
    const existing = await this.prisma.anime.findUnique({
      where: { slug },
      include: { genres: { select: { slug: true } } },
    });
    if (
      existing &&
      existing.ageRating !== ADULT_AGE_RATING &&
      !existing.genres.some((g) => g.slug === ADULT_GENRE_SLUG)
    ) {
      slug = `${src.slug}-hentai`;
      console.error(`[ADULT-SYNC] slug em colisão, usando ${slug}`);
    }
    if (dryRun) return existing ? 'updated' : 'created';

    const genreConnect = [
      ...new Map(
        [...src.genres, { slug: ADULT_GENRE_SLUG, name: 'Hentai' }].map((g) => [
          g.slug,
          g,
        ]),
      ).values(),
    ].map((g) => ({
      where: { slug: g.slug },
      create: { slug: g.slug, name: g.name },
    }));

    const data = {
      title: src.title,
      synopsis: src.synopsis,
      coverImage: src.coverImage,
      bannerImage: src.bannerImage,
      rating: src.rating,
      ageRating: ADULT_AGE_RATING,
      status: src.status,
      audio: src.audio,
      format: src.format,
      year: src.year,
      season: src.season,
      studios: src.studios,
      themes: src.themes,
      alternativeTitles: src.alternativeTitles,
      japaneseTitle: src.japaneseTitle,
      source: src.source,
      releaseDate: src.releaseDate,
      endDate: src.endDate,
      episodeCount: src.episodeCount,
      published: src.published,
      genres: { connectOrCreate: genreConnect },
    };

    const anime = await this.prisma.anime.upsert({
      where: { slug },
      update: data,
      create: { slug, ...data },
      select: { id: true },
    });

    for (const ep of src.episodes) {
      await this.prisma.episode.upsert({
        where: {
          animeId_season_number: {
            animeId: anime.id,
            season: ep.season,
            number: ep.number,
          },
        },
        update: {
          title: ep.title,
          thumbnailUrl: ep.thumbnailUrl,
          videoUrl: ep.videoUrl,
          embedUrl: ep.embedUrl,
          duration: ep.duration,
          sourceId: ep.sourceId,
        },
        create: {
          animeId: anime.id,
          season: ep.season,
          number: ep.number,
          title: ep.title,
          thumbnailUrl: ep.thumbnailUrl,
          videoUrl: ep.videoUrl,
          embedUrl: ep.embedUrl,
          duration: ep.duration,
          sourceId: ep.sourceId,
        },
      });
    }
    return existing ? 'updated' : 'created';
  }
}
