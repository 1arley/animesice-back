/**
 * RepairWorker — varre episódios com videoUrl null/videoBroken=true + amostra
 * aleatória de episódios antigos p/ probe. Enfileira REPAIR_EPISODE p/ os
 * mortos (prioridade 50, cap diário configurável via env WT_REPAIR_DAILY_CAP).
 *
 * Reusa probeMediaUrlDead (common/media-probe).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { probeMediaUrlDead } from '@/common/media-probe';
import { JobsService } from './jobs.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

const DEFAULT_DAILY_CAP = 20;
const SAMPLE_SIZE = 50;

@Injectable()
export class RepairWorker {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  async sweep(): Promise<number> {
    const cap = Number(process.env.WT_REPAIR_DAILY_CAP ?? DEFAULT_DAILY_CAP);
    let enqueued = 0;

    const broken = await this.prisma.episode.findMany({
      where: {
        OR: [{ videoUrl: null }, { videoBroken: true }],
        embedUrl: { not: null },
      },
      take: cap,
      select: { id: true, animeId: true, number: true },
    });
    for (const ep of broken) {
      await this.jobs.enqueue({
        type: JOB_TYPE.REPAIR_EPISODE,
        dedupeKey: `repair:${ep.animeId}:${ep.number}`,
        payload: { animeId: ep.animeId, episodeNumber: ep.number },
        priority: PRIORITY.REPAIR,
      });
      enqueued++;
    }

    if (enqueued >= cap) return enqueued;

    const sample = await this.prisma.episode.findMany({
      where: { videoUrl: { not: null }, videoBroken: false },
      take: SAMPLE_SIZE,
      select: { id: true, animeId: true, number: true, videoUrl: true },
    });
    for (const ep of sample) {
      if (enqueued >= cap) break;
      if (!ep.videoUrl) continue;
      const dead = await probeMediaUrlDead(ep.videoUrl);
      if (dead) {
        await this.prisma.episode
          .update({
            where: { id: ep.id },
            data: { videoBroken: true },
          })
          .catch(() => undefined);
        await this.jobs.enqueue({
          type: JOB_TYPE.REPAIR_EPISODE,
          dedupeKey: `repair:${ep.animeId}:${ep.number}`,
          payload: { animeId: ep.animeId, episodeNumber: ep.number },
          priority: PRIORITY.REPAIR,
        });
        enqueued++;
      }
    }
    return enqueued;
  }
}
