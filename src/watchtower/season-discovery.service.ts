/**
 * SeasonDiscovery — 1x/dia busca anime da temporada atual (AniList) que não
 * estão no catálogo. Cria Anime (metadados AniList) e enfileira EXTRAÇÕES p/ os
 * episódios que já foram ao ar.
 *
 * Anti-duplicação por anilistId (@unique no Anime). Ambíguos (sem match por
 * anilistId) vão p/ job de revisão admin.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AniListClient, AniListMediaSummary } from './anilist-client.service';
import { JobsService } from './jobs.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

type Season = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';

const VALID_FORMATS = new Set([
  'TV',
  'MOVIE',
  'OVA',
  'ONA',
  'SPECIAL',
  'MUSIC',
]);

function mapFormat(
  raw?: string | null,
): 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'MUSIC' | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (VALID_FORMATS.has(upper))
    return upper as 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'MUSIC';
  return null;
}

function currentSeason(now: Date = new Date()): {
  season: Season;
  year: number;
} {
  const month = now.getMonth();
  const year = now.getFullYear();
  let season: Season;
  if (month <= 2) season = 'WINTER';
  else if (month <= 5) season = 'SPRING';
  else if (month <= 8) season = 'SUMMER';
  else season = 'FALL';
  let yr = year;
  if (month === 0 && season === 'WINTER') yr = year;
  return { season, year: yr };
}

function slugify(input: string): string {
  return (
    input
      .toString()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/[''`]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 80) || 'anime'
  );
}

@Injectable()
export class SeasonDiscovery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anilist: AniListClient,
    private readonly jobs: JobsService,
  ) {}

  async discover(): Promise<number> {
    const { season, year } = currentSeason();
    let created = 0;
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      let batch: AniListMediaSummary[];
      try {
        const r = await this.anilist.seasonMedia(season, year, page);
        batch = r.media;
        hasNext = r.hasNext;
      } catch (err) {
        console.error(
          '[WATCHTOWER] season discovery falhou:',
          err instanceof Error ? err.message : String(err),
        );
        break;
      }

      const existing = await this.prisma.anime.findMany({
        where: {
          OR: [
            { anilistId: { in: batch.map(({ id }) => id) } },
            {
              slug: {
                in: batch.map((media) =>
                  slugify(
                    media.title?.romaji ||
                      media.title?.english ||
                      media.title?.native ||
                      `anime-${media.id}`,
                  ),
                ),
              },
            },
          ],
        },
        select: { anilistId: true, slug: true },
      });
      const existingIds = new Set(existing.map(({ anilistId }) => anilistId));
      const usedSlugs = new Set(existing.map(({ slug }) => slug));
      const candidates = batch
        .filter((media) => !existingIds.has(media.id))
        .map((media) => {
          const title =
            media.title?.romaji ||
            media.title?.english ||
            media.title?.native ||
            `anime-${media.id}`;
          const slug = slugify(title);
          const finalSlug = usedSlugs.has(slug) ? `${slug}-${media.id}` : slug;
          usedSlugs.add(finalSlug);
          return {
            media,
            finalSlug,
            data: {
              slug: finalSlug,
              title,
              synopsis:
                media.description
                  ?.replace(/<br\s*\/?>/g, '\n')
                  .replace(/<[^>]+>/g, '')
                  .slice(0, 2000) ?? null,
              coverImage:
                media.coverImage?.large ?? media.coverImage?.extraLarge ?? null,
              bannerImage: media.bannerImage ?? null,
              rating: media.averageScore ? media.averageScore / 10 : 0,
              status: media.status === 'FINISHED' ? 'COMPLETO' : 'LANCAMENTO',
              audio: 'LEGENDADO' as const,
              ageRating: media.isAdult ? 'A18' : 'A14',
              anilistId: media.id,
              year: media.seasonYear ?? null,
              season:
                (media.season as 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL') ??
                null,
              format: mapFormat(media.format),
              episodeCount: media.episodes ?? null,
              studios:
                media.studios?.nodes
                  ?.map((n) => n.name)
                  .filter((n): n is string => Boolean(n)) ?? [],
            },
          };
        });

      const inserted = await this.prisma.anime.createMany({
        data: candidates.map(({ data }) => data),
        skipDuplicates: true,
      });
      created += inserted.count;
      if (inserted.count > 0) {
        const animes = await this.prisma.anime.findMany({
          where: { anilistId: { in: candidates.map(({ media }) => media.id) } },
          select: { id: true, anilistId: true },
        });
        const animeByAniList = new Map(
          animes.map((anime) => [anime.anilistId, anime.id]),
        );
        const genreData = candidates.flatMap(({ media }) =>
          (media.genres ?? [])
            .filter((name): name is string => Boolean(name && slugify(name)))
            .map((name) => ({ name, slug: slugify(name) })),
        );
        if (genreData.length > 0) {
          await this.prisma.genre.createMany({
            data: genreData,
            skipDuplicates: true,
          });
          const genres = await this.prisma.genre.findMany({
            where: { slug: { in: genreData.map(({ slug }) => slug) } },
            select: { id: true, slug: true },
          });
          const genreBySlug = new Map(
            genres.map((genre) => [genre.slug, genre.id]),
          );
          const links = candidates.flatMap(({ media }) => {
            const animeId = animeByAniList.get(media.id);
            if (!animeId) return [];
            return (media.genres ?? []).flatMap((name) => {
              const genreId = name ? genreBySlug.get(slugify(name)) : undefined;
              return genreId ? [{ animeId, genreId }] : [];
            });
          });
          if (links.length > 0) {
            const values = Prisma.join(
              links.map(
                ({ animeId, genreId }) => Prisma.sql`(${animeId}, ${genreId})`,
              ),
            );
            await this.prisma.$executeRaw`
              INSERT INTO "_AnimeToGenre" ("A", "B") VALUES ${values}
              ON CONFLICT DO NOTHING
            `;
          }
        }

        const jobInputs = (
          await Promise.all(
            candidates.map(async ({ media, finalSlug }) => {
              const animeId = animeByAniList.get(media.id);
              if (!animeId) return [];
              try {
                const schedule = await this.anilist.airingSchedule(media.id);
                return schedule
                  .filter((item) => item.airingAt * 1000 <= Date.now())
                  .map((ep) => ({
                    type: JOB_TYPE.EXTRACT_EPISODE,
                    dedupeKey: `extract:${animeId}:${ep.episode}`,
                    payload: {
                      animeId,
                      slug: finalSlug,
                      episodeNumber: ep.episode,
                    },
                    priority: PRIORITY.EXTRACT,
                  }));
              } catch {
                return [];
              }
            }),
          )
        ).flat();
        await this.jobs.enqueueMany(jobInputs);
      }
      page++;
    }
    return created;
  }
}
