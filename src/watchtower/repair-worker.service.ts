/**
 * RepairWorker — varre episódios com videoUrl null/videoBroken=true + amostra
 * aleatória de episódios antigos p/ probe. Enfileira REPAIR_EPISODE p/ os
 * mortos (prioridade 50, cap diário configurável via env WT_REPAIR_DAILY_CAP).
 *
 * Post-split: sem filtro embedUrl — eps recém-criados pelo scan podem não ter
 * embedUrl ainda mas ainda precisam de repair. Cap aumentado para 500 default
 * (33k eps no catálogo, 20/dia = 4.5 anos).
 *
 * Reusa probeMediaUrlDead (common/media-probe).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { probeMediaUrlDead } from '@/common/media-probe';
import { JobsService } from './jobs.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

const DEFAULT_DAILY_CAP = 500;
const SAMPLE_SIZE = 200;

@Injectable()
export class RepairWorker {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  async sweep(): Promise<number> {
    const cap = Number(process.env.WT_REPAIR_DAILY_CAP ?? DEFAULT_DAILY_CAP);

    // Sem filtro embedUrl — eps sem embed também precisam de repair
    const broken = await this.prisma.episode.findMany({
      where: {
        OR: [{ videoUrl: null }, { videoBroken: true }],
      },
      take: cap,
      select: { id: true, animeId: true, number: true, season: true },
    });

    const enqueueInputs: Array<{
      type: string;
      dedupeKey: string;
      payload: { animeId: string; episodeNumber: number; season: number };
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
        },
        priority: PRIORITY.REPAIR,
      });
    }

    let enqueued = enqueueInputs.length;

    if (enqueued >= cap) {
      await this.jobs.enqueueMany(enqueueInputs);
      return enqueued;
    }

    // Amostra maior p/ detectar vídeos mortos mais rápido
    const sample = await this.prisma.episode.findMany({
      where: { videoUrl: { not: null }, videoBroken: false },
      take: SAMPLE_SIZE,
      orderBy: { videoCheckedAt: 'asc' },
      select: {
        id: true,
        animeId: true,
        number: true,
        season: true,
        videoUrl: true,
      },
    });
    const deadIds: string[] = [];
    for (const ep of sample) {
      if (enqueued >= cap) break;
      if (!ep.videoUrl) continue;
      const dead = await probeMediaUrlDead(ep.videoUrl);
      if (dead) {
        deadIds.push(ep.id);
        enqueueInputs.push({
          type: JOB_TYPE.REPAIR_EPISODE,
          dedupeKey: `repair:${ep.animeId}:${ep.season ?? 1}:${ep.number}`,
          payload: {
            animeId: ep.animeId,
            episodeNumber: ep.number,
            season: ep.season ?? 1,
          },
          priority: PRIORITY.REPAIR,
        });
        enqueued++;
      }
    }

    // Batch: marcar episódios mortos + enfileirar repair jobs em uma ida.
    if (deadIds.length > 0) {
      await this.prisma.episode
        .updateMany({
          where: { id: { in: deadIds } },
          data: { videoBroken: true },
        })
        .catch(() => undefined);
    }
    await this.jobs.enqueueMany(enqueueInputs);
    return enqueued;
  }
}
