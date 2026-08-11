/**
 * SeasonDiscovery — 1x/dia busca anime da temporada atual (AniList) que não
 * estão no catálogo. Cria Anime (metadados AniList) e enfileira EXTRAÇÕES p/ os
 * episódios que já foram ao ar.
 *
 * Anti-duplicação por anilistId (@unique no Anime). Ambíguos (sem match por
 * anilistId) vão p/ job de revisão admin.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AniListClient, AniListMediaSummary } from './anilist-client.service';
import { JobsService } from './jobs.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

type Season = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';

const VALID_FORMATS = new Set(['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC']);

function mapFormat(raw?: string | null): 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'MUSIC' | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (VALID_FORMATS.has(upper)) return upper as 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'MUSIC';
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

      for (const media of batch) {
        const exists = await this.prisma.anime.findUnique({
          where: { anilistId: media.id },
          select: { id: true },
        });
        if (exists) continue;

        const title =
          media.title?.romaji ||
          media.title?.english ||
          media.title?.native ||
          `anime-${media.id}`;
        const slug = slugify(title);
        const slugCollide = await this.prisma.anime.findUnique({
          where: { slug },
          select: { id: true },
        });
        const finalSlug = slugCollide ? `${slug}-${media.id}` : slug;

        try {
          const anime = await this.prisma.anime.create({
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
              audio: 'LEGENDADO',
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
              genres: undefined,
            },
          });

          if (media.genres?.length) {
            for (const g of media.genres) {
              if (!g) continue;
              const gSlug = slugify(g);
              if (!gSlug) continue;
              const genre = await this.prisma.genre.upsert({
                where: { slug: gSlug },
                update: { name: g },
                create: { slug: gSlug, name: g },
              });
              await this.prisma.anime
                .update({
                  where: { id: anime.id },
                  data: { genres: { connect: { id: genre.id } } },
                })
                .catch(() => undefined);
            }
          }

          try {
            const schedule = await this.anilist.airingSchedule(media.id);
            const aired = schedule.filter(
              (s) => s.airingAt * 1000 <= Date.now(),
            );
            for (const ep of aired) {
              await this.jobs.enqueue({
                type: JOB_TYPE.EXTRACT_EPISODE,
                dedupeKey: `extract:${anime.id}:${ep.episode}`,
                payload: {
                  animeId: anime.id,
                  slug: finalSlug,
                  episodeNumber: ep.episode,
                },
                priority: PRIORITY.EXTRACT,
              });
            }
          } catch {
            // sem airingSchedule — não enfileira extract, será pego no próximo CHECK_RELEASES
          }

          created++;
        } catch (err) {
          console.error(
            `[WATCHTOWER] create anime falhou (${finalSlug}):`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      page++;
    }
    return created;
  }
}
