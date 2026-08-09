/**
 * Validator — confere dados obrigatórios do episódio extraído + probe de mídia.
 *
 * Obrigatórios: number, videoUrl vivo (probeMediaUrlDead=false),
 * thumbnailUrl (fallback capa do anime), título default.
 * Reusa util compartilhado em common/media-probe.
 */
import { Injectable } from '@nestjs/common';
import { probeMediaUrlDead } from '@/common/media-probe';
import { PrismaService } from '@/prisma/prisma.service';

export interface EpisodeCandidate {
  videoUrl: string;
  thumbnailUrl?: string | null;
  title?: string | null;
  duration?: string | null;
  sourceId: string;
}

@Injectable()
export class Validator {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns primeira sequência de fontes (por ordem) cujo videoUrl passe no probe,
   * null se todas falharem.
   * @param candidates resultado de extração (já ordenado por preferência de fonte)
   * @param animeId usado p/ fallback thumbnail (capa do anime)
   */
  async pickValid(
    candidates: EpisodeCandidate[],
    animeId: string,
  ): Promise<EpisodeCandidate | null> {
    let animeCover: string | null = null;

    for (const c of candidates) {
      if (!c.videoUrl) continue;
      const dead = await probeMediaUrlDead(c.videoUrl);
      if (dead) continue;
      if (!c.thumbnailUrl) {
        if (animeCover === null) {
          const a = await this.prisma.anime.findUnique({
            where: { id: animeId },
            select: { coverImage: true },
          });
          animeCover = a?.coverImage ?? null;
        }
        c.thumbnailUrl = animeCover;
      }
      return c;
    }
    return null;
  }
}
