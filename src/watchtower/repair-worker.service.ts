/**
 * RepairWorker — varre episódios com videoUrl null/videoBroken=true + amostra
 * aleatória de episódios antigos p/ probe. Enfileira REPAIR_EPISODE p/ os
 * mortos (prioridade baixa, cap diário configurável via env WT_REPAIR_DAILY_CAP).
 *
 * Post-split: sem filtro embedUrl — eps recém-criados pelo scan podem não ter
 * embedUrl ainda mas ainda precisam de repair. A amostra roda em rodízio
 * semanal para não sondar sempre os primeiros episódios.
 *
 * Reusa probeMediaUrlDead (common/media-probe).
 */
import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { probeMediaUrlDead, signedExpiryDead } from '@/common/media-probe';
import { EpisodeResolution } from './episode-resolution.service';
import { JobsService } from './jobs.service';
import { extractJobKey, JOB_TYPE, PRIORITY } from './watchtower.types';

// A amostra pode fazer probes HTTP sequenciais; mantenha o trabalho diário curto.
const DEFAULT_DAILY_CAP = 5000;
const DEFAULT_PENDING_REPAIR_CAP = 1000;
const SOURCE_BACKFILL_CAP = 50;
const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60_000;

/** Pausa repair sweep se fila de extração (EXTRACT_EPISODE) passar deste limite. */
const EXTRACTION_QUEUE_BACKPRESSURE = 200;
const RUST_REPAIR_HOSTS = [
  'meusanimes.blog',
  'meusdoramas.club',
  'animesonline.cloud',
];

function rustCanRepair(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return RUST_REPAIR_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

@Injectable()
export class RepairWorker {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    @Optional() private readonly episodes?: EpisodeResolution,
  ) {}

  async sweep(slugFilter?: string): Promise<number> {
    const configuredCap = Number(
      process.env.WT_REPAIR_DAILY_CAP ?? DEFAULT_DAILY_CAP,
    );
    const dailyCap =
      Number.isSafeInteger(configuredCap) && configuredCap > 0
        ? configuredCap
        : DEFAULT_DAILY_CAP;
    const anime = slugFilter
      ? { published: true, slug: slugFilter }
      : { published: true };

    // Backpressure: pausa repair se fila de EXTRACT_EPISODE estiver saturada
    // (evita encher a fila com reparos enquanto extrações novas não saem).
    const pendingExtracts = await this.prisma.watchtowerJob.count({
      where: { type: JOB_TYPE.EXTRACT_EPISODE, status: 'PENDING' },
    });
    if (pendingExtracts > EXTRACTION_QUEUE_BACKPRESSURE) {
      console.error(
        `[REPAIR] backpressure: ${pendingExtracts} EXTRACT_EPISODE pendentes > ${EXTRACTION_QUEUE_BACKPRESSURE}, sweep pulado`,
      );
      return 0;
    }

    const configuredBacklogCap = Number(
      process.env.WT_REPAIR_MAX_PENDING ?? DEFAULT_PENDING_REPAIR_CAP,
    );
    const backlogCap =
      Number.isSafeInteger(configuredBacklogCap) && configuredBacklogCap > 0
        ? configuredBacklogCap
        : DEFAULT_PENDING_REPAIR_CAP;
    const pendingRepairs = await this.prisma.watchtowerJob.count({
      where: {
        type: JOB_TYPE.REPAIR_EPISODE,
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });
    const cap = Math.min(dailyCap, Math.max(0, backlogCap - pendingRepairs));
    if (cap === 0) {
      console.error(
        `[REPAIR] backlog cap: ${pendingRepairs} jobs pendentes/em execução >= ${backlogCap}; sweep adiado`,
      );
      return 0;
    }

    // Sem filtro embedUrl — eps sem embed também precisam de repair
    const checkBefore = new Date(Date.now() - CHECK_INTERVAL_MS);
    const broken = await this.prisma.episode.findMany({
      where: {
        OR: [{ videoUrl: null }, { videoBroken: true }],
        AND: [
          {
            OR: [
              { repairQueuedAt: null },
              { repairQueuedAt: { lt: checkBefore } },
            ],
          },
        ],
        anime,
      },
      take: cap,
      orderBy: [{ repairQueuedAt: { sort: 'asc', nulls: 'first' } }],
      select: {
        id: true,
        animeId: true,
        number: true,
        season: true,
        sources: { select: { pageUrl: true, verifiedAt: true } },
      },
    });

    const enqueueInputs: Array<{
      type: string;
      dedupeKey: string;
      payload: {
        animeId: string;
        episodeNumber: number;
        season: number;
        rustEligible: boolean;
      };
      priority: number;
    }> = [];

    for (const ep of broken) {
      enqueueInputs.push({
        type: JOB_TYPE.REPAIR_EPISODE,
        dedupeKey: `repair:${ep.animeId}:${ep.season ?? 1}:${ep.number}`,
        payload: {
          animeId: ep.animeId,
          episodeNumber: ep.number,
          season: ep.season ?? 1,
          rustEligible: ep.sources.some(
            (source) =>
              source.verifiedAt !== null && rustCanRepair(source.pageUrl),
          ),
        },
        priority: PRIORITY.REPAIR,
      });
    }

    const acceptedBroken =
      enqueueInputs.length > 0
        ? await this.jobs.enqueueMany(enqueueInputs, backlogCap)
        : [];
    const acceptedBrokenSet = new Set(acceptedBroken);
    const queuedBroken = broken.filter((episode) =>
      acceptedBrokenSet.has(
        `repair:${episode.animeId}:${episode.season ?? 1}:${episode.number}`,
      ),
    );
    if (queuedBroken.length > 0) {
      await this.prisma.episode.updateMany({
        where: { id: { in: queuedBroken.map((episode) => episode.id) } },
        data: { repairQueuedAt: new Date() },
      });
    }
    const alreadyEnqueued = acceptedBroken.length;
    if (alreadyEnqueued >= cap) {
      return alreadyEnqueued;
    }

    // Amostra maior p/ detectar vídeos mortos mais rápido
    const sample = await this.prisma.episode.findMany({
      where: {
        videoUrl: { not: null },
        videoBroken: false,
        OR: [{ videoCheckedAt: null }, { videoCheckedAt: { lt: checkBefore } }],
        anime,
      },
      take: Math.max(0, cap - alreadyEnqueued),
      orderBy: [{ videoCheckedAt: { sort: 'asc', nulls: 'first' } }],
      select: {
        id: true,
        animeId: true,
        number: true,
        season: true,
        videoUrl: true,
        sources: { select: { pageUrl: true, verifiedAt: true } },
      },
    });
    const deadIds: string[] = [];
    const checkedIds: string[] = [];
    const sampleInputs: typeof enqueueInputs = [];
    for (const ep of sample) {
      if (alreadyEnqueued + sampleInputs.length >= cap) break;
      checkedIds.push(ep.id);
      if (!ep.videoUrl) continue;
      // Tokens googlevideo/Blogger expiram em ~8h. signedExpiryDead decide
      // isso localmente (parse do `expire`), sem gastar request de rede;
      // só URLs sem expiração determinística caem no probe HTTP.
      const signed = signedExpiryDead(ep.videoUrl);
      const dead =
        signed === null ? await probeMediaUrlDead(ep.videoUrl) : signed;
      if (dead) {
        deadIds.push(ep.id);
        sampleInputs.push({
          type: JOB_TYPE.REPAIR_EPISODE,
          dedupeKey: `repair:${ep.animeId}:${ep.season ?? 1}:${ep.number}`,
          payload: {
            animeId: ep.animeId,
            episodeNumber: ep.number,
            season: ep.season ?? 1,
            rustEligible: ep.sources.some(
              (source) =>
                source.verifiedAt !== null && rustCanRepair(source.pageUrl),
            ),
          },
          priority: PRIORITY.REPAIR,
        });
      }
    }
    // Enfileira antes de marcar a amostra para não perder reparos em falha de DB.
    const acceptedSample =
      sampleInputs.length > 0
        ? await this.jobs.enqueueMany(sampleInputs, backlogCap)
        : [];
    const enqueued = alreadyEnqueued + acceptedSample.length;
    if (checkedIds.length > 0) {
      await this.prisma.episode.updateMany({
        where: { id: { in: checkedIds } },
        data: { videoCheckedAt: new Date() },
      });
    }
    if (deadIds.length > 0) {
      await this.prisma.episode
        .updateMany({
          where: { id: { in: deadIds } },
          data: { videoBroken: true },
        })
        .catch(() => undefined);
      // Despublica animes que ficaram 100% sem vídeo.
      const affected = await this.prisma.episode.findMany({
        where: { id: { in: deadIds } },
        select: { animeId: true },
        distinct: ['animeId'],
      });
      for (const { animeId } of affected) {
        await this.unpublishIfFullyBroken(animeId);
      }
    }
    return enqueued;
  }

  /** Completa fontes secundárias em lote pequeno e com intervalo entre tentativas. */
  async backfillSources(): Promise<number> {
    const episodes = await this.prisma.$queryRaw<
      Array<{ animeId: string; slug: string; number: number; season: number }>
    >`
      SELECT e."animeId", a.slug, e.number, e.season
      FROM "Episode" e
      JOIN "Anime" a ON a.id = e."animeId"
      LEFT JOIN "EpisodeSource" s ON s."episodeId" = e.id
        AND s."verifiedAt" IS NOT NULL
      LEFT JOIN "WatchtowerJob" j ON j.type = 'EXTRACT_EPISODE'
        AND j."dedupeKey" = 'extract:' || e."animeId" || ':' || e.season || ':' || e.number
      WHERE a.published = true
        AND (j.id IS NULL OR (j.status IN ('DONE', 'DEAD')
          AND j."updatedAt" < NOW() - INTERVAL '7 days'))
      GROUP BY e.id, e."animeId", a.slug, e.number, e.season, e."updatedAt", j."updatedAt"
      HAVING COUNT(DISTINCT s."sourceId") < 2
      ORDER BY COALESCE(j."updatedAt", e."updatedAt") ASC
      LIMIT ${SOURCE_BACKFILL_CAP}
    `;
    if (episodes.length === 0) return 0;

    await this.jobs.enqueueMany(
      episodes.map((episode) => ({
        type: JOB_TYPE.EXTRACT_EPISODE,
        dedupeKey: extractJobKey(
          episode.animeId,
          episode.season,
          episode.number,
        ),
        payload: {
          animeId: episode.animeId,
          slug: episode.slug,
          episodeNumber: episode.number,
          season: episode.season,
        },
        priority: PRIORITY.SOURCE_BACKFILL,
      })),
    );
    return episodes.length;
  }

  private async unpublishIfFullyBroken(animeId: string): Promise<void> {
    if (this.episodes) {
      await this.episodes.unpublishIfFullyBroken(animeId);
      return;
    }
    const anime = await this.prisma.anime.findUnique({
      where: { id: animeId },
      select: { id: true, published: true },
    });
    if (!anime || !anime.published) return;
    const working = await this.prisma.episode.count({
      where: {
        animeId,
        videoBroken: false,
        videoUrl: { not: null },
        NOT: { videoUrl: '' },
      },
    });
    if (working > 0) return;
    await this.prisma.anime
      .update({
        where: { id: animeId },
        data: { published: false, catalogUnpublished: true },
      })
      .catch(() => undefined);
  }
}
