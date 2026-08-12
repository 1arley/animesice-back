import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { AuthService } from '@/auth/auth.service';
import { UpdateSiteSettingsDto, UpdatePrivacyDto } from './dto/settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly authService: AuthService,
  ) {}

  // ── Personal settings: account ────────────────────────────────────────

  async getAccountSettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        userName: true,
        role: true,
        isVerified: true,
        avatar: true,
        bio: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user;
  }

  async changeEmail(userId: string, newEmail: string, password: string) {
    return this.authService.requestEmailChange(userId, newEmail, password);
  }

  async confirmEmailChange(token: string) {
    return this.authService.confirmEmailChange(token);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    return this.authService.changePassword(
      userId,
      currentPassword,
      newPassword,
    );
  }

  async updateProfile(userId: string, name?: string, userName?: string) {
    return this.authService.updateProfile(userId, name, userName);
  }

  // ── Personal settings: privacy ──────────────────────────────────────

  async getPrivacySettings(userId: string) {
    const [privacy, privateListsCount] = await this.prisma.$transaction([
      this.prisma.privacySettings.upsert({
        where: { userId },
        update: {},
        create: { userId },
        select: {
          profilePublic: true,
          showActivity: true,
          showFavorites: true,
          showRatings: true,
        },
      }),
      this.prisma.userAnimeList.count({
        where: { userId, private: true },
      }),
    ]);

    return {
      ...privacy,
      privateAnimeLists: privateListsCount,
    };
  }

  async updatePrivacySettings(userId: string, dto: UpdatePrivacyDto) {
    await this.prisma.privacySettings.upsert({
      where: { userId },
      update: {
        ...(dto.profilePublic !== undefined
          ? { profilePublic: dto.profilePublic }
          : {}),
        ...(dto.showActivity !== undefined
          ? { showActivity: dto.showActivity }
          : {}),
        ...(dto.showFavorites !== undefined
          ? { showFavorites: dto.showFavorites }
          : {}),
        ...(dto.showRatings !== undefined
          ? { showRatings: dto.showRatings }
          : {}),
      },
      create: { userId },
    });

    return this.getPrivacySettings(userId);
  }

  // ── Personal settings: notifications ──────────────────────────────────

  async getNotificationPreferences(userId: string) {
    return this.notificationService.getPreferences(userId);
  }

  async updateNotificationPreference(
    userId: string,
    typeId: NotificationType,
    channel: NotificationChannel,
    enabled: boolean,
  ) {
    return this.notificationService.updatePreference(
      userId,
      typeId,
      channel,
      enabled,
    );
  }

  // ── Site settings (ADMIN, SUPERADMIN) ─────────────────────────────────
  // Persistidas no DB (model SiteSetting) com fallback p/ env vars quando a
  // chave nunca foi gravada.

  async getSiteSettings() {
    const rows = await this.prisma.siteSetting.findMany();
    const stored = new Map(rows.map((r) => [r.key, r.value]));

    return {
      siteName: stored.get('SITE_NAME') ?? process.env.SITE_NAME ?? 'AnimesIce',
      siteDescription:
        stored.get('SITE_DESCRIPTION') ??
        process.env.SITE_DESCRIPTION ??
        'Catálogo de animes com streaming',
      registrationOpen:
        stored.get('REGISTRATION_OPEN') !== undefined
          ? stored.get('REGISTRATION_OPEN') !== 'false'
          : process.env.REGISTRATION_OPEN !== 'false',
      maintenanceMode:
        stored.get('MAINTENANCE_MODE') !== undefined
          ? stored.get('MAINTENANCE_MODE') === 'true'
          : process.env.MAINTENANCE_MODE === 'true',
    };
  }

  async updateSiteSettings(dto: UpdateSiteSettingsDto) {
    const entries: Array<[string, string]> = [];
    if (dto.siteName !== undefined) entries.push(['SITE_NAME', dto.siteName]);
    if (dto.siteDescription !== undefined)
      entries.push(['SITE_DESCRIPTION', dto.siteDescription]);
    if (dto.registrationOpen !== undefined)
      entries.push([
        'REGISTRATION_OPEN',
        dto.registrationOpen ? 'true' : 'false',
      ]);
    if (dto.maintenanceMode !== undefined)
      entries.push([
        'MAINTENANCE_MODE',
        dto.maintenanceMode ? 'true' : 'false',
      ]);

    for (const [key, value] of entries) {
      await this.prisma.siteSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    return this.getSiteSettings();
  }

  // ── Admin settings: user management (ADMIN, SUPERADMIN) ──────────────

  async listUsersForAdmin(page: number = 1, limit: number = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          userName: true,
          role: true,
          isVerified: true,
          suspendedUntil: true,
          suspendedReason: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count(),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getUserDetailForAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        userName: true,
        role: true,
        isVerified: true,
        avatar: true,
        bio: true,
        suspendedUntil: true,
        suspendedReason: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            comments: true,
            ratings: true,
            favorites: true,
            watchHistories: true,
            reportsFiled: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user;
  }
}
