import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaService } from '@/prisma/prisma.service';
import { ADULT_AGE_RATING, ADULT_GENRE_SLUG } from '@/common/adult';

const PAGE_SIZE = 100;

/** Marcador de "full-copy já concluído" em SiteSetting — shared entre réplicas. */
const SYNC_MARKER_KEY = 'adultSync.completedAt';

/** Cursor incremental: último `updatedAt` já importado. Sem ele => full-copy. */
const SYNC_CURSOR_KEY = 'adultSync.lastUpdatedAt';

function syncEnabled(): boolean {
  return (
    process.env.ADULT_CATALOG_ENABLED === 'true' &&
    process.env.SITE_MODE !== 'hentai' &&
    Boolean(process.env.HENTAI_SOURCE_DATABASE_URL)
  );
}

@Injectable()
export class AdultCatalogSyncService implements OnApplicationBootstrap {
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void | Promise<void> {
    // Full-copy na 1ª boot só. Sem marcador => nunca sincronizou => roda.
    // Com marcador => deploys seguintes pulam (o cron 04:00 mantém o refresh).
    // Cada full-copy cruza o catálogo inteiro pelo pooler do Supabase (egress);
    // com release automático isso re-copiava tudo a cada deploy. Fire-and-forget
    // de propósito: o sync bloquearia app.listen() (healthcheck 502 no Traefik).
    if (!syncEnabled()) return;
    return (async () => {
      if (await this.isSyncComplete()) {
        console.log('[ADULT-SYNC] boot: já sincronizado, pulando full-copy');
        return;
      }
      void this.handleCron();
    })();
  }

  /** true => uma sincronização completa já gravou o marcador. Em erro => false
   *  (re-tenta no boot; upserts idempotentes, sem risco de perda). */
  private async isSyncComplete(): Promise<boolean> {
    try {
      const row = await this.prisma.siteSetting.findUnique({
        where: { key: SYNC_MARKER_KEY },
        select: { value: true },
      });
      return Boolean(row?.value);
    } catch {
      return false;
    }
  }

  /** Grava o marcador após um full-copy bem-sucedido. Falha não derruba o boot. */
  private async markSynced(): Promise<void> {
    try {
      await this.prisma.siteSetting.upsert({
        where: { key: SYNC_MARKER_KEY },
        update: { value: new Date().toISOString() },
        create: { key: SYNC_MARKER_KEY, value: new Date().toISOString() },
      });
    } catch (e) {
      console.error(
        '[ADULT-SYNC] falha ao gravar marcador:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  @Cron('0 4 * * *')
  async handleCron(): Promise<void> {
    if (!syncEnabled() || this.running) return;

    this.running = true;
    try {
      await this.sync();
      await this.markSynced();
    } catch (e) {
      console.error(
        '[ADULT-SYNC] falhou:',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      this.running = false;
    }
  }

  /** Lê o cursor incremental; null => ainda não sincronizou (full-copy). */
  private async readCursor(): Promise<Date | null> {
    try {
      const row = await this.prisma.siteSetting.findUnique({
        where: { key: SYNC_CURSOR_KEY },
        select: { value: true },
      });
      if (!row?.value) return null;
      const d = new Date(row.value);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }

  /** Avança o cursor para o maior `updatedAt` já importado. */
  private async writeCursor(at: Date): Promise<void> {
    try {
      await this.prisma.siteSetting.upsert({
        where: { key: SYNC_CURSOR_KEY },
        update: { value: at.toISOString() },
        create: { key: SYNC_CURSOR_KEY, value: at.toISOString() },
      });
    } catch (e) {
      console.error(
        '[ADULT-SYNC] falha ao gravar cursor:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  async sync(opts?: { dryRun?: boolean; limit?: number }) {
    const sourceUrl = process.env.HENTAI_SOURCE_DATABASE_URL || '';
    const source = new PrismaClient({
      adapter: new PrismaPg(new Pool({ connectionString: sourceUrl })),
    });
    let imported = 0;
    let updated = 0;
    // Só o pass completo (cron diário) avança o cursor. dryRun e runs limitados
    // (backfill manual) não tocam no estado de sincronização.
    // ponytail: incremental por Anime.updatedAt => só pega edits no anime-pai;
    // mudança exclusiva de um episódio na origem não re-puxa (catálogo hentai é
    // estático). Upgrade: diffar episodes[] por updatedAt também se virar ruído.
    const useCursor = !opts?.limit && !opts?.dryRun;
    const since = useCursor ? await this.readCursor() : null;
    let lastUpdatedAt: Date | null = null;
    try {
      await this.prisma.genre.upsert({
        where: { slug: ADULT_GENRE_SLUG },
        update: {},
        create: { slug: ADULT_GENRE_SLUG, name: 'Hentai' },
      });
      let skip = 0;
      for (;;) {
        const batch = await source.anime.findMany({
          where: {
            published: true,
            ...(since ? { updatedAt: { gt: since } } : {}),
          },
          select: {
            slug: true,
            title: true,
            synopsis: true,
            coverImage: true,
            bannerImage: true,
            rating: true,
            status: true,
            audio: true,
            format: true,
            year: true,
            season: true,
            studios: true,
            themes: true,
            alternativeTitles: true,
            japaneseTitle: true,
            source: true,
            releaseDate: true,
            endDate: true,
            episodeCount: true,
            published: true,
            updatedAt: true,
            genres: { select: { slug: true, name: true } },
            episodes: {
              select: {
                season: true,
                number: true,
                title: true,
                thumbnailUrl: true,
                videoUrl: true,
                embedUrl: true,
                duration: true,
                sourceId: true,
              },
            },
          },
          orderBy: { updatedAt: 'asc' },
          take: Math.min(PAGE_SIZE, (opts?.limit ?? PAGE_SIZE) - imported),
          skip,
        });
        if (batch.length === 0) break;
        for (const src of batch) {
          if (!lastUpdatedAt || src.updatedAt > lastUpdatedAt) {
            lastUpdatedAt = src.updatedAt;
          }
          const res = await this.upsertOne(src, opts?.dryRun);
          if (res === 'created') imported += 1;
          else if (res === 'updated') updated += 1;
          if (opts?.limit && imported + updated >= opts.limit) break;
        }
        if (opts?.limit && imported + updated >= opts.limit) break;
        if (batch.length < PAGE_SIZE) break;
        skip += batch.length;
      }
      if (useCursor && lastUpdatedAt) {
        await this.writeCursor(lastUpdatedAt);
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
      updatedAt: Date;
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
