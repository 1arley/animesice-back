import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { ReportStatus, ContentStatus, NotificationType } from '@prisma/client';
import {
  CreateReportDto,
  ResolveReportDto,
  ModerateUserDto,
} from '@/moderation/dto/moderation.dto';

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async createReport(reporterId: string, dto: CreateReportDto) {
    await this.validateTarget(dto.targetType, dto.targetId);

    return this.prisma.report.create({
      data: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        notes: dto.notes,
      },
      include: {
        reporter: { select: { id: true, name: true, userName: true } },
      },
    });
  }

  async listReports(page = 1, limit = 20, status?: string) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [reports, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        include: {
          reporter: { select: { id: true, name: true, userName: true } },
          moderator: { select: { id: true, name: true, userName: true } },
        },
      }),
      this.prisma.report.count({ where }),
    ]);

    return {
      data: reports,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async resolveReport(
    reportId: string,
    moderatorId: string,
    resolvedStatus: ReportStatus,
    dto: ResolveReportDto,
  ) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Denúncia não encontrada.');
    }

    return this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: resolvedStatus,
        moderatorId,
        moderationNote: dto.moderationNote,
        resolvedAt: new Date(),
      },
      include: {
        reporter: { select: { id: true, name: true, userName: true } },
        moderator: { select: { id: true, name: true, userName: true } },
      },
    });
  }

  async moderateUser(
    targetUserId: string,
    moderatorId: string,
    dto: ModerateUserDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, userName: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const actionType = dto.actionType;
    const expiresAt = dto.hours
      ? new Date(Date.now() + dto.hours * 3600_000)
      : dto.actionType === 'WARN'
        ? null
        : null;

    const action = await this.prisma.moderationAction.create({
      data: {
        userId: targetUserId,
        actionType,
        reason: dto.reason,
        moderatorId,
        expiresAt,
      },
    });

    if (actionType === 'MUTE' || actionType === 'BAN') {
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: {
          suspendedUntil: expiresAt,
          suspendedReason: dto.reason ?? actionType,
        },
      });
    }

    void this.notificationService.create({
      userId: targetUserId,
      type: NotificationType.MODERATION_ACTION,
      title: `Ação de moderação: ${actionType}`,
      body: dto.reason ?? 'Você recebeu uma ação de moderação.',
    });

    return action;
  }

  async deleteComment(commentId: string, _moderatorId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, status: true },
    });

    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { status: ContentStatus.HIDDEN_BY_MOD },
    });
  }

  async isUserSuspended(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { suspendedUntil: true },
    });

    if (!user?.suspendedUntil) return false;
    return user.suspendedUntil > new Date();
  }

  private async validateTarget(
    targetType: CreateReportDto['targetType'],
    targetId: string,
  ) {
    let exists = false;
    switch (targetType) {
      case 'COMMENT':
        exists = !!(await this.prisma.comment.findUnique({
          where: { id: targetId },
          select: { id: true },
        }));
        break;
      case 'ROOM_MESSAGE':
        exists = !!(await this.prisma.roomMessage.findUnique({
          where: { id: targetId },
          select: { id: true },
        }));
        break;
      case 'USER':
        exists = !!(await this.prisma.user.findUnique({
          where: { id: targetId },
          select: { id: true },
        }));
        break;
      case 'ANIME':
        exists = !!(await this.prisma.anime.findUnique({
          where: { id: targetId },
          select: { id: true },
        }));
        break;
    }
    if (!exists) {
      throw new BadRequestException('Alvo da denúncia não encontrado.');
    }
  }
}
