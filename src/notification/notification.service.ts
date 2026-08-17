import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationType, NotificationChannel } from '@prisma/client';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, page = 1, limit = 20, unreadOnly = false) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    const where = {
      userId,
      ...(unreadOnly ? { read: false } : {}),
    };

    const [notifications, total, unreadCount, prefCount] =
      await this.prisma.$transaction([
        this.prisma.notification.findMany({
          where,
          skip,
          take: safeLimit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.notification.count({ where }),
        this.prisma.notification.count({
          where: { userId, read: false },
        }),
        this.prisma.notificationPreference.count({ where: { userId } }),
      ]);

    if (prefCount === 0) {
      void this.seedDefaultPreferences(userId);
    }

    return {
      data: notifications,
      unreadCount,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notificação não encontrada.');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { message: 'Todas as notificações marcadas como lidas.' };
  }

  private async isPreferenceEnabled(
    userId: string,
    typeId: NotificationType,
    channel: NotificationChannel = NotificationChannel.IN_APP,
  ): Promise<boolean> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_typeId_channel: { userId, typeId, channel },
      },
    });

    if (pref) return pref.enabled;

    void this.seedDefaultPreferences(userId);
    return true;
  }

  async create(data: {
    userId: string;
    type: string;
    title: string;
    body?: string;
    linkUrl?: string;
  }) {
    const typeId = data.type as NotificationType;

    const enabled = await this.isPreferenceEnabled(data.userId, typeId);
    if (!enabled) return null;

    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        linkUrl: data.linkUrl,
      },
    });
  }

  async notifyNewEpisode(
    animeId: string,
    animeTitle: string,
    episodeNumber: number,
    animeSlug: string,
  ) {
    const watchers = await this.prisma.userAnimeList.findMany({
      where: {
        animeId,
        status: 'WATCHING',
      },
      select: {
        userId: true,
        user: {
          select: {
            notificationPreferences: {
              where: {
                typeId: NotificationType.NEW_EPISODE,
                channel: NotificationChannel.IN_APP,
              },
              select: { enabled: true },
            },
          },
        },
      },
    });

    const enabledWatchers = watchers.filter(
      (watcher) => watcher.user.notificationPreferences[0]?.enabled !== false,
    );
    if (enabledWatchers.length === 0) return { count: 0 };

    return this.prisma.notification.createMany({
      data: enabledWatchers.map(({ userId }) => ({
        userId,
        type: NotificationType.NEW_EPISODE,
        title: `Novo episódio: ${animeTitle} #${episodeNumber}`,
        body: `O episódio ${episodeNumber} de ${animeTitle} está disponível!`,
        linkUrl: `/animes/${animeSlug}/${episodeNumber}`,
      })),
    });
  }

  async notifyCommentReply(
    parentCommentId: string,
    replyAuthorName: string,
    animeSlug?: string,
  ) {
    const parent = await this.prisma.comment.findUnique({
      where: { id: parentCommentId },
      select: { userId: true, animeId: true, episodeId: true },
    });

    if (!parent) return null;
    if (parent.userId === null) return null;

    let linkUrl = '/';
    if (animeSlug) {
      linkUrl = `/animes/${animeSlug}`;
    }

    return this.create({
      userId: parent.userId,
      type: NotificationType.COMMENT_REPLY,
      title: `${replyAuthorName} respondeu seu comentário`,
      body: 'Clique para ver a resposta.',
      linkUrl,
    });
  }

  async notifyCommentLike(
    commentId: string,
    likerName: string,
    animeSlug?: string,
  ) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { userId: true },
    });

    if (!comment) return null;
    if (comment.userId === null) return null;

    return this.create({
      userId: comment.userId,
      type: NotificationType.COMMENT_LIKE,
      title: `${likerName} curtiu seu comentário`,
      linkUrl: animeSlug ? `/animes/${animeSlug}` : '/',
    });
  }

  async getPreferences(userId: string) {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });

    if (prefs.length === 0) {
      await this.seedDefaultPreferences(userId);
      return this.prisma.notificationPreference.findMany({
        where: { userId },
      });
    }

    return prefs;
  }

  async updatePreference(
    userId: string,
    typeId: NotificationType,
    channel: NotificationChannel,
    enabled: boolean,
  ) {
    return this.prisma.notificationPreference.upsert({
      where: {
        userId_typeId_channel: { userId, typeId, channel },
      },
      update: { enabled },
      create: { userId, typeId, channel, enabled },
    });
  }

  private async seedDefaultPreferences(userId: string) {
    const types = Object.values(NotificationType);
    const channels = Object.values(NotificationChannel);

    await this.prisma.notificationPreference.createMany({
      data: types.flatMap((typeId) =>
        channels.map((channel) => ({ userId, typeId, channel, enabled: true })),
      ),
      skipDuplicates: true,
    });
  }
}
