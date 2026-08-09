/**
 * ReleaseMonitor — p/ cada anime LANCAMENTO com anilistId, compara airingSchedule
 * (AniList) vs episódios no DB. Episódio já deveria ter saído (airingAt <= agora)
 * mas não existe no catálogo → enfileira EXTRACT_EPISODE.
 *
 * Também enfileira SYNC_AIRING (preenche airingSchedule no cache local se precisar).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AniListClient } from './anilist-client.service';
import { JobsService } from './jobs.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

@Injectable()
export class ReleaseMonitor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anilist: AniListClient,
    private readonly jobs: JobsService,
  ) {}

  async checkAll(): Promise<number> {
    const animes = await this.prisma.anime.findMany({
      where: { status: 'LANCAMENTO', anilistId: { not: null } },
      select: { id: true, slug: true, anilistId: true },
    });
    let enqueued = 0;
    for (const anime of animes) {
      if (!anime.anilistId) continue;
      try {
        const schedule = await this.anilist.airingSchedule(anime.anilistId);
        const aired = schedule.filter((s) => s.airingAt * 1000 <= Date.now());
        if (aired.length === 0) continue;

        const existing = await this.prisma.episode.findMany({
          where: { animeId: anime.id },
          select: { number: true },
        });
        const have = new Set(existing.map((e) => e.number));

        for (const ep of aired) {
          if (!have.has(ep.episode)) {
            await this.jobs.enqueue({
              type: JOB_TYPE.EXTRACT_EPISODE,
              dedupeKey: `extract:${anime.id}:${ep.episode}`,
              payload: {
                animeId: anime.id,
                slug: anime.slug,
                episodeNumber: ep.episode,
              },
              priority: PRIORITY.EXTRACT,
            });
            enqueued++;
          }
        }
      } catch (err) {
        console.error(
          `[WATCHTOWER] release-check falhou ${anime.slug}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return enqueued;
  }

  async checkOne(animeId: string): Promise<number> {
    const anime = await this.prisma.anime.findUnique({
      where: { id: animeId },
      select: { id: true, slug: true, anilistId: true },
    });
    if (!anime || !anime.anilistId) return 0;
    const schedule = await this.anilist.airingSchedule(anime.anilistId);
    const aired = schedule.filter((s) => s.airingAt * 1000 <= Date.now());
    if (aired.length === 0) return 0;

    const existing = await this.prisma.episode.findMany({
      where: { animeId: anime.id },
      select: { number: true },
    });
    const have = new Set(existing.map((e) => e.number));
    let enqueued = 0;
    for (const ep of aired) {
      if (!have.has(ep.episode)) {
        await this.jobs.enqueue({
          type: JOB_TYPE.EXTRACT_EPISODE,
          dedupeKey: `extract:${anime.id}:${ep.episode}`,
          payload: {
            animeId: anime.id,
            slug: anime.slug,
            episodeNumber: ep.episode,
          },
          priority: PRIORITY.EXTRACT,
        });
        enqueued++;
      }
    }
    return enqueued;
  }
}
