/**
 * Publisher — upsert Episode no DB por (animeId, number), atualiza sourceId,
 * marca videoCheckedAt, dispara notificação NEW_EPISODE e atualiza status do
 * anime (COMPLETO quando AniList diz FINISHED).
 *
 * Anti-duplicação: @@unique([animeId, number]) no Prisma garante 1 episódio
 * por número. Upsert idempotente.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';

export interface PublishInput {
  animeId: string;
  episodeNumber: number;
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
    const existing = await this.prisma.episode.findUnique({
      where: {
        animeId_number: {
          animeId: input.animeId,
          number: input.episodeNumber,
        },
      },
      select: { id: true },
    });

    const episode = await this.prisma.episode.upsert({
      where: {
        animeId_number: {
          animeId: input.animeId,
          number: input.episodeNumber,
        },
      },
      update: {
        videoUrl: input.videoUrl,
        embedUrl: input.embedUrl,
        sourceId: input.sourceId,
        videoBroken: false,
        videoCheckedAt: new Date(),
        ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.duration ? { duration: input.duration } : {}),
      },
      create: {
        animeId: input.animeId,
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

    await this.prisma.episode
      .update({
        where: { id: episode.id },
        data: { dateModified: new Date() },
      })
      .catch(() => undefined);
  }

  /** Marca anime como COMPLETO quando airingSchedule indica fim. */
  async markAnimeComplete(animeId: string): Promise<void> {
    await this.prisma.anime
      .update({
        where: { id: animeId },
        data: { status: 'COMPLETO' },
      })
      .catch(() => undefined);
  }
}
