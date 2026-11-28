import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminNotificationAudience,
  AdminNotificationCategory,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  ADMIN_NOTIFICATION_MAX_SELECTED,
  SendAdminNotificationDto,
} from '@/notification/dto/send-admin-notification.dto';

/** Lote de escrita para envios globais — mantém a transação curta. */
const GLOBAL_BATCH_SIZE = 500;

const ADMIN_SELECT = {
  id: true,
  name: true,
  userName: true,
} satisfies Prisma.UserSelect;

const RECIPIENT_SELECT = {
  id: true,
  userName: true,
  name: true,
  avatar: true,
  role: true,
} satisfies Prisma.UserSelect;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AdminNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Busca destinatários por nome, @usuário, e-mail ou id exato. */
  async searchRecipients(search?: string, page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;
    const term = search?.trim();

    const where: Prisma.UserWhereInput = term
      ? {
          OR: [
            { userName: { contains: term, mode: 'insensitive' } },
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            ...(UUID_PATTERN.test(term) ? [{ id: term }] : []),
          ],
        }
      : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ userName: 'asc' }, { id: 'asc' }],
        skip,
        take: safeLimit,
        select: RECIPIENT_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /** Estimativa exibida na confirmação de envio global. */
  async countGlobalAudience() {
    const count = await this.prisma.user.count();
    return { count };
  }

  async send(adminId: string, dto: SendAdminNotificationDto) {
    if (
      dto.audience === AdminNotificationAudience.GLOBAL &&
      dto.confirmGlobal !== true
    ) {
      throw new BadRequestException(
        'Envio global exige confirmação explícita (confirmGlobal: true).',
      );
    }

    const userIds = await this.resolveRecipients(dto);

    const existing = await this.findByDedupeKey(adminId, dto.dedupeKey);
    if (existing) {
      return { ...existing, duplicate: true };
    }

    let campaign;
    try {
      campaign = await this.prisma.adminNotification.create({
        data: {
          adminId,
          category: dto.category,
          audience: dto.audience,
          title: dto.title.trim(),
          body: dto.body.trim(),
          linkUrl: dto.linkUrl?.trim() || null,
          dedupeKey: dto.dedupeKey,
        },
        include: { admin: { select: ADMIN_SELECT } },
      });
    } catch (error) {
      // Corrida entre duas requisições com a mesma chave: devolve a vencedora.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.findByDedupeKey(adminId, dto.dedupeKey);
        if (winner) return { ...winner, duplicate: true };
      }
      throw error;
    }

    let delivered = 0;
    try {
      if (dto.audience === AdminNotificationAudience.GLOBAL) {
        delivered = await this.deliverGlobally(campaign.id, dto);
      } else {
        delivered = await this.deliverTo(userIds, campaign.id, dto);
      }
    } catch (error) {
      // Preserva a contagem parcial para o histórico refletir a realidade.
      await this.prisma.adminNotification
        .update({
          where: { id: campaign.id },
          data: { recipientCount: delivered },
        })
        .catch(() => undefined);
      throw error;
    }

    const saved = await this.prisma.adminNotification.update({
      where: { id: campaign.id },
      data: { recipientCount: delivered },
      include: { admin: { select: ADMIN_SELECT } },
    });

    return { ...saved, duplicate: false };
  }

  async listHistory(
    page = 1,
    limit = 20,
    filters: { category?: AdminNotificationCategory; search?: string } = {},
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;
    const term = filters.search?.trim();

    const where: Prisma.AdminNotificationWhereInput = {
      ...(filters.category ? { category: filters.category } : {}),
      ...(term
        ? {
            OR: [
              { title: { contains: term, mode: 'insensitive' } },
              { body: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.adminNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
        include: { admin: { select: ADMIN_SELECT } },
      }),
      this.prisma.adminNotification.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getCampaign(id: string, page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    const campaign = await this.prisma.adminNotification.findUnique({
      where: { id },
      include: { admin: { select: ADMIN_SELECT } },
    });
    if (!campaign) {
      throw new NotFoundException('Comunicado não encontrado.');
    }

    const [recipients, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { adminNotificationId: id },
        orderBy: [{ userId: 'asc' }, { id: 'asc' }],
        skip,
        take: safeLimit,
        select: {
          id: true,
          read: true,
          createdAt: true,
          user: { select: RECIPIENT_SELECT },
        },
      }),
      this.prisma.notification.count({
        where: { adminNotificationId: id },
      }),
    ]);

    return {
      ...campaign,
      recipients: {
        data: recipients,
        meta: {
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit),
        },
      },
    };
  }

  private async resolveRecipients(
    dto: SendAdminNotificationDto,
  ): Promise<string[]> {
    if (dto.audience === AdminNotificationAudience.GLOBAL) return [];

    const userIds = Array.from(new Set(dto.userIds ?? []));
    if (userIds.length === 0) {
      throw new BadRequestException('Selecione ao menos um destinatário.');
    }
    if (userIds.length > ADMIN_NOTIFICATION_MAX_SELECTED) {
      throw new BadRequestException(
        `Envie para no máximo ${ADMIN_NOTIFICATION_MAX_SELECTED} jogadores por vez.`,
      );
    }
    if (
      dto.audience === AdminNotificationAudience.SINGLE &&
      userIds.length !== 1
    ) {
      throw new BadRequestException(
        'Envio individual aceita exatamente um destinatário.',
      );
    }

    const found = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });
    if (found.length !== userIds.length) {
      throw new BadRequestException('Um ou mais destinatários não existem.');
    }

    return userIds;
  }

  private notificationData(
    userId: string,
    campaignId: string,
    dto: SendAdminNotificationDto,
  ): Prisma.NotificationCreateManyInput {
    return {
      userId,
      type: NotificationType.SYSTEM,
      title: dto.title.trim(),
      body: dto.body.trim(),
      linkUrl: dto.linkUrl?.trim() || null,
      adminNotificationId: campaignId,
      adminCategory: dto.category,
    };
  }

  private async deliverTo(
    userIds: string[],
    campaignId: string,
    dto: SendAdminNotificationDto,
  ): Promise<number> {
    await this.prisma.notification.createMany({
      data: userIds.map((userId) =>
        this.notificationData(userId, campaignId, dto),
      ),
    });
    return userIds.length;
  }

  /**
   * Percorre os usuários por cursor e grava em lotes. Evita carregar toda a
   * base em memória e mantém cada INSERT curto durante um comunicado global.
   */
  private async deliverGlobally(
    campaignId: string,
    dto: SendAdminNotificationDto,
  ): Promise<number> {
    let delivered = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.user.findMany({
        where: cursor ? { id: { gt: cursor } } : undefined,
        orderBy: { id: 'asc' },
        take: GLOBAL_BATCH_SIZE,
        select: { id: true },
      });
      if (batch.length === 0) break;

      await this.prisma.notification.createMany({
        data: batch.map(({ id }) => this.notificationData(id, campaignId, dto)),
      });
      delivered += batch.length;
      const last = batch.at(-1);
      if (!last) break;
      cursor = last.id;
    }

    return delivered;
  }

  private async findByDedupeKey(adminId: string, dedupeKey: string) {
    return this.prisma.adminNotification.findFirst({
      where: { adminId, dedupeKey },
      include: { admin: { select: ADMIN_SELECT } },
    });
  }
}
