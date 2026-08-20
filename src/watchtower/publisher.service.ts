/**
 * Publisher — upsert Episode no DB por (animeId, season, number), atualiza
 * sourceId, marca videoCheckedAt, dispara notificação NEW_EPISODE e atualiza
 * status do anime (FINALIZADO quando AniList diz FINISHED).
 *
 * Anti-duplicação: @@unique([animeId, season, number]) no Prisma garante 1
 * episódio por (temporada, número). Upsert idempotente.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';

export interface PublishInput {
  animeId: string;
  episodeNumber: number;
  season?: number;
  videoUrl: string;
  embedUrl: string;
  sourceId: string;
  thumbnailUrl?: string | null;
  title?: string | null;
  duration?: string | null;
}

@Injectable()
export class Publisher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async publish(input: PublishInput): Promise<void> {
    const season = input.season ?? 1;
    const existing = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: input.animeId,
          season,
          number: input.episodeNumber,
        },
      },
      select: { id: true },
    });

    await this.prisma.episode.upsert({
      where: {
        animeId_season_number: {
          animeId: input.animeId,
          season,
          number: input.episodeNumber,
        },
      },
      update: {
        videoUrl: input.videoUrl,
        embedUrl: input.embedUrl,
        sourceId: input.sourceId,
        videoBroken: false,
        videoCheckedAt: new Date(),
        dateModified: new Date(),
        ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.duration ? { duration: input.duration } : {}),
      },
      create: {
        animeId: input.animeId,
        season,
        number: input.episodeNumber,
        videoUrl: input.videoUrl,
        embedUrl: input.embedUrl,
        sourceId: input.sourceId,
        videoBroken: false,
        videoCheckedAt: new Date(),
        title: input.title ?? `Episódio ${input.episodeNumber}`,
        thumbnailUrl: input.thumbnailUrl ?? null,
        duration: input.duration ?? null,
      },
    });

    // Só notifica em episódio realmente novo. Com reap/ownership corrigidos,
    // dois workers não processam o mesmo job (dedupeKey) → sem dupla notificação.
    if (!existing) {
      const anime = await this.prisma.anime.findUnique({
        where: { id: input.animeId },
        select: { slug: true, title: true },
      });
      if (anime) {
        void this.notifications
          .notifyNewEpisode(
            input.animeId,
            anime.title,
            input.episodeNumber,
            anime.slug,
          )
          .catch(() => undefined);
      }
    }
  }

  /** Marca anime como FINALIZADO quando airingSchedule indica fim. */
  async markAnimeComplete(animeId: string): Promise<void> {
    await this.prisma.anime
      .update({
        where: { id: animeId },
        data: { status: 'FINALIZADO' },
      })
      .catch(() => undefined);
  }
}
