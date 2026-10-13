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
import { probeMediaUrlDead, signedExpiryDead } from '@/common/media-probe';
import { JobsService } from './jobs.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

// 500 episódios/dia deixa o catálogo aquecido sem abrir centenas de Chromium
// ao mesmo tempo; a fila continua serializada pelo batch do Watchtower.
const DEFAULT_DAILY_CAP = 500;

@Injectable()
export class RepairWorker {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  async sweep(slugFilter?: string): Promise<number> {
    const cap = Number(process.env.WT_REPAIR_DAILY_CAP ?? DEFAULT_DAILY_CAP);
    const anime = slugFilter
      ? { published: true, slug: slugFilter }
      : { published: true };

    // Sem filtro embedUrl — eps sem embed também precisam de repair
    const broken = await this.prisma.episode.findMany({
      where: {
        OR: [{ videoUrl: null }, { videoBroken: true }],
        anime,
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
      where: {
        videoUrl: { not: null },
        videoBroken: false,
        anime,
      },
      // Espaço de busca = orçamento do sweep: signedExpiryDead decide sem
      // rede, então varrer `cap` linhas custa o mesmo que sondar 200.
      take: cap,
      // Mais antigos primeiro: com TTL de ~8h, os últimos extraídos são os
      // que mais provavelmente venceram.
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        animeId: true,
        number: true,
        season: true,
        videoUrl: true,
      },
    });
    const deadIds: string[] = [];
    const checkedIds = sample.map((ep) => ep.id);
    for (const ep of sample) {
      if (enqueued >= cap) break;
      if (!ep.videoUrl) continue;
      // Tokens googlevideo/Blogger expiram em ~8h. signedExpiryDead decide
      // isso localmente (parse do `expire`), sem gastar request de rede;
      // só URLs sem expiração determinística caem no probe HTTP.
      const signed = signedExpiryDead(ep.videoUrl);
      const dead =
        signed === null ? await probeMediaUrlDead(ep.videoUrl) : signed;
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
    if (checkedIds.length > 0) {
      await this.prisma.episode
        .updateMany({
          where: { id: { in: checkedIds } },
          data: { videoCheckedAt: new Date() },
        })
        .catch(() => undefined);
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
    if (enqueueInputs.length > 0) {
      await this.jobs.enqueueMany(enqueueInputs);
    }
    return enqueued;
  }
}
