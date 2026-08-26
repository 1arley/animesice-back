import { SettingsService } from './settings.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

function makeMocks() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    privacySettings: { upsert: jest.fn() },
    userAnimeList: { count: jest.fn() },
    siteSetting: { findMany: jest.fn() },
    anime: { count: jest.fn() },
    episode: { count: jest.fn() },
    comment: { count: jest.fn() },
    post: { count: jest.fn() },
    report: { count: jest.fn() },
    rating: { count: jest.fn() },
    favorite: { count: jest.fn() },
    siteFeedback: { count: jest.fn() },
    animeRequest: { count: jest.fn() },
    watchHistory: { count: jest.fn() },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $executeRaw: jest.fn(),
  };
  const notificationService = {
    getPreferences: jest.fn(),
    updatePreference: jest.fn(),
  };
  const authService = {
    requestEmailChange: jest.fn(),
    confirmEmailChange: jest.fn(),
    changePassword: jest.fn(),
    updateProfile: jest.fn(),
  };
  const svc = new SettingsService(
    prisma as any,
    notificationService as any,
    authService as any,
  );
  return { prisma, notificationService, authService, svc };
}

describe('SettingsService.getAccountSettings', () => {
  it('retorna o usuário quando encontrado', async () => {
    const { prisma, svc } = makeMocks();
    const user = {
      id: 'u1',
      email: 'a@b.com',
      name: 'Ana',
      userName: 'ana',
      role: 'USER',
      isVerified: true,
      avatar: null,
      bio: null,
      createdAt: new Date(),
    };
    prisma.user.findUnique.mockResolvedValue(user);
    expect(await svc.getAccountSettings('u1')).toEqual(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: expect.objectContaining({ id: true, email: true }),
    });
  });

  it('lança NotFoundException quando usuário não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.getAccountSettings('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('SettingsService delegações de conta', () => {
  it('changeEmail delega ao authService', async () => {
    const { authService, svc } = makeMocks();
    authService.requestEmailChange.mockResolvedValue({
      message: 'Email alterado com sucesso.',
    });
    const result = await svc.changeEmail('u1', 'novo@b.com', 'senha');
    expect(authService.requestEmailChange).toHaveBeenCalledWith(
      'u1',
      'novo@b.com',
      'senha',
    );
    expect(result.message).toBe('Email alterado com sucesso.');
  });

  it('confirmEmailChange delega ao authService', async () => {
    const { authService, svc } = makeMocks();
    authService.confirmEmailChange.mockResolvedValue({
      message: 'Email alterado com sucesso.',
    });
    const result = await svc.confirmEmailChange('token-123');
    expect(authService.confirmEmailChange).toHaveBeenCalledWith('token-123');
    expect(result.message).toBe('Email alterado com sucesso.');
  });

  it('changePassword delega ao authService', async () => {
    const { authService, svc } = makeMocks();
    authService.changePassword.mockResolvedValue({
      message: 'Senha alterada com sucesso.',
    });
    const result = await svc.changePassword('u1', 'atual', 'nova');
    expect(authService.changePassword).toHaveBeenCalledWith(
      'u1',
      'atual',
      'nova',
    );
    expect(result.message).toBe('Senha alterada com sucesso.');
  });

  it('updateProfile delega ao authService', async () => {
    const { authService, svc } = makeMocks();
    authService.updateProfile.mockResolvedValue({ id: 'u1', name: 'Ana' });
    const result = await svc.updateProfile('u1', 'Ana', 'ana');
    expect(authService.updateProfile).toHaveBeenCalledWith('u1', 'Ana', 'ana');
    expect(result.name).toBe('Ana');
  });
});

describe('SettingsService.getPrivacySettings', () => {
  it('retorna privacidade combinada com contagem de listas privadas', async () => {
    const { prisma, svc } = makeMocks();
    prisma.privacySettings.upsert.mockResolvedValue({
      profilePublic: true,
      showActivity: true,
      showFavorites: false,
      showRatings: true,
    });
    prisma.userAnimeList.count.mockResolvedValue(3);

    const result = await svc.getPrivacySettings('u1');
    expect(result.privateAnimeLists).toBe(3);
    expect(result.profilePublic).toBe(true);
    expect(prisma.privacySettings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      update: {},
      create: { userId: 'u1' },
      select: expect.any(Object),
    });
  });
});

describe('SettingsService.updatePrivacySettings', () => {
  it('monta update parcial e retorna o resultado de getPrivacySettings', async () => {
    const { prisma, svc } = makeMocks();
    prisma.privacySettings.upsert
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        profilePublic: true,
        showActivity: true,
        showFavorites: false,
        showRatings: true,
      });
    prisma.userAnimeList.count.mockResolvedValue(0);

    const result = await svc.updatePrivacySettings('u1', {
      profilePublic: true,
    });
    expect(prisma.privacySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        update: { profilePublic: true },
        create: { userId: 'u1' },
      }),
    );
    expect(result.profilePublic).toBe(true);
  });

  it('passa todos os campos quando presentes', async () => {
    const { prisma, svc } = makeMocks();
    prisma.privacySettings.upsert
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        profilePublic: false,
        showActivity: false,
        showFavorites: true,
        showRatings: false,
      });
    prisma.userAnimeList.count.mockResolvedValue(0);

    await svc.updatePrivacySettings('u1', {
      profilePublic: false,
      showActivity: false,
      showFavorites: true,
      showRatings: false,
    });
    expect(prisma.privacySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          profilePublic: false,
          showActivity: false,
          showFavorites: true,
          showRatings: false,
        },
      }),
    );
  });

  it('dto vazio gera update sem campos extras', async () => {
    const { prisma, svc } = makeMocks();
    prisma.privacySettings.upsert
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        profilePublic: true,
        showActivity: true,
        showFavorites: true,
        showRatings: true,
      });
    prisma.userAnimeList.count.mockResolvedValue(0);

    await svc.updatePrivacySettings('u1', {});
    expect(prisma.privacySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });
});

describe('SettingsService notificações', () => {
  it('getNotificationPreferences delega ao notificationService', async () => {
    const { notificationService, svc } = makeMocks();
    notificationService.getPreferences.mockResolvedValue([{ id: 'p1' }]);
    const result = await svc.getNotificationPreferences('u1');
    expect(notificationService.getPreferences).toHaveBeenCalledWith('u1');
    expect(result).toEqual([{ id: 'p1' }]);
  });

  it('updateNotificationPreference delega ao notificationService', async () => {
    const { notificationService, svc } = makeMocks();
    notificationService.updatePreference.mockResolvedValue({ enabled: false });
    const result = await svc.updateNotificationPreference(
      'u1',
      'NEW_COMMENT' as any,
      'EMAIL',
      false,
    );
    expect(notificationService.updatePreference).toHaveBeenCalledWith(
      'u1',
      'NEW_COMMENT',
      'EMAIL',
      false,
    );
    expect(result.enabled).toBe(false);
  });
});

describe('SettingsService.getSiteSettings', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('usa valores armazenados quando existem', async () => {
    const { prisma, svc } = makeMocks();
    prisma.siteSetting.findMany.mockResolvedValue([
      { key: 'SITE_NAME', value: 'Meu Site' },
      { key: 'SITE_DESCRIPTION', value: 'Descrição do site' },
      { key: 'REGISTRATION_OPEN', value: 'false' },
      { key: 'MAINTENANCE_MODE', value: 'true' },
    ]);
    const result = await svc.getSiteSettings();
    expect(result.siteName).toBe('Meu Site');
    expect(result.siteDescription).toBe('Descrição do site');
    expect(result.registrationOpen).toBe(false);
    expect(result.maintenanceMode).toBe(true);
  });

  it('cai no fallback de env vars quando nada está armazenado', async () => {
    const { prisma, svc } = makeMocks();
    prisma.siteSetting.findMany.mockResolvedValue([]);
    process.env.SITE_NAME = 'Env Site';
    process.env.SITE_DESCRIPTION = 'Env Desc';
    process.env.REGISTRATION_OPEN = 'false';
    process.env.MAINTENANCE_MODE = 'true';
    const result = await svc.getSiteSettings();
    expect(result.siteName).toBe('Env Site');
    expect(result.siteDescription).toBe('Env Desc');
    expect(result.registrationOpen).toBe(false);
    expect(result.maintenanceMode).toBe(true);
  });

  it('usa defaults quando nada está configurado', async () => {
    const { prisma, svc } = makeMocks();
    prisma.siteSetting.findMany.mockResolvedValue([]);
    delete process.env.SITE_NAME;
    delete process.env.SITE_DESCRIPTION;
    delete process.env.REGISTRATION_OPEN;
    delete process.env.MAINTENANCE_MODE;
    const result = await svc.getSiteSettings();
    expect(result.siteName).toBe('AnimesIce');
    expect(result.siteDescription).toBe('Catálogo de animes com streaming');
    expect(result.registrationOpen).toBe(true);
    expect(result.maintenanceMode).toBe(false);
  });

  it('interpreta strings armazenadas para booleans', async () => {
    const { prisma, svc } = makeMocks();
    prisma.siteSetting.findMany.mockResolvedValue([
      { key: 'REGISTRATION_OPEN', value: 'true' },
      { key: 'MAINTENANCE_MODE', value: 'false' },
    ]);
    const result = await svc.getSiteSettings();
    expect(result.registrationOpen).toBe(true);
    expect(result.maintenanceMode).toBe(false);
  });
});

describe('SettingsService.updateSiteSettings', () => {
  it('grava todas as entradas fornecidas via $executeRaw', async () => {
    const { prisma, svc } = makeMocks();
    prisma.siteSetting.findMany.mockResolvedValue([]);
    await svc.updateSiteSettings({
      siteName: 'Novo Nome',
      siteDescription: 'Nova Desc',
      registrationOpen: true,
      maintenanceMode: false,
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('não executa upsert quando dto vazio', async () => {
    const { prisma, svc } = makeMocks();
    prisma.siteSetting.findMany.mockResolvedValue([]);
    await svc.updateSiteSettings({});
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('converte registrationOpen/maintenanceMode para string', async () => {
    const { prisma, svc } = makeMocks();
    prisma.siteSetting.findMany.mockResolvedValue([]);
    await svc.updateSiteSettings({
      registrationOpen: false,
      maintenanceMode: true,
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});

describe('SettingsService.listUsersForAdmin', () => {
  it('lista usuários sem busca com paginação e meta', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    prisma.user.count.mockResolvedValue(1);
    const result = await svc.listUsersForAdmin(1, 20);
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it('aplica caps no limit (0 -> 1, 999 -> 100)', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(150);
    const result = await svc.listUsersForAdmin(1, 0);
    expect(result.meta.limit).toBe(1);
    const result2 = await svc.listUsersForAdmin(1, 999);
    expect(result2.meta.limit).toBe(100);
  });

  it('monta OR de busca quando search informado', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    await svc.listUsersForAdmin(1, 20, 'ana');
    const arg = prisma.user.findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { email: { contains: 'ana', mode: 'insensitive' } },
      { name: { contains: 'ana', mode: 'insensitive' } },
      { userName: { contains: 'ana', mode: 'insensitive' } },
    ]);
  });
});

describe('SettingsService.getUserDetailForAdmin', () => {
  it('retorna detalhes do usuário com contadores', async () => {
    const { prisma, svc } = makeMocks();
    const user = { id: 'u1', _count: { comments: 1, ratings: 2 } };
    prisma.user.findUnique.mockResolvedValue(user);
    expect(await svc.getUserDetailForAdmin('u1')).toEqual(user);
  });

  it('lança NotFoundException quando usuário não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.getUserDetailForAdmin('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('SettingsService.deleteUser', () => {
  it('exclui usuário com sucesso', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'u2', role: 'USER' });
    prisma.user.delete.mockResolvedValue({});
    const result = await svc.deleteUser('u2', 'admin1');
    expect(result.message).toBe('Usuário excluído com sucesso.');
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'u2' },
    });
  });

  it('lança NotFoundException quando usuário não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.deleteUser('x', 'admin')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lança ForbiddenException ao excluir a si mesmo', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
    await expect(svc.deleteUser('admin', 'admin')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lança ForbiddenException ao excluir um SUPERADMIN', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'super',
      role: 'SUPERADMIN',
    });
    await expect(svc.deleteUser('super', 'admin')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('SettingsService.updateUserRole', () => {
  it('atualiza role com sucesso', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'u2', role: 'USER' });
    prisma.user.update.mockResolvedValue({ id: 'u2', role: 'ADMIN' });
    const result = await svc.updateUserRole(
      'u2',
      Role.ADMIN,
      'admin1',
      Role.SUPERADMIN,
    );
    expect(result.role).toBe('ADMIN');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u2' },
        data: { role: Role.ADMIN },
      }),
    );
  });

  it('lança NotFoundException quando usuário não existe', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.updateUserRole('x', Role.ADMIN, 'admin')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lança ForbiddenException ao alterar o próprio cargo', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
    await expect(
      svc.updateUserRole('admin', Role.USER, 'admin', Role.SUPERADMIN),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lança ForbiddenException ao promover a SUPERADMIN sem ser SUPERADMIN', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'u2', role: 'USER' });
    await expect(
      svc.updateUserRole('u2', Role.SUPERADMIN, 'admin', Role.ADMIN),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('SettingsService.getDashboardStats', () => {
  it('agrega totais, moderação e métricas semanais', async () => {
    const { prisma, svc } = makeMocks();
    prisma.user.count
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    prisma.anime.count.mockResolvedValue(50);
    prisma.episode.count.mockResolvedValue(400);
    prisma.comment.count.mockResolvedValueOnce(20).mockResolvedValueOnce(1);
    prisma.post.count.mockResolvedValueOnce(10).mockResolvedValueOnce(0);
    prisma.report.count.mockResolvedValue(4);
    prisma.rating.count.mockResolvedValue(600);
    prisma.favorite.count.mockResolvedValue(120);
    prisma.siteFeedback.count.mockResolvedValue(2);
    prisma.animeRequest.count.mockResolvedValue(3);
    prisma.watchHistory.count.mockResolvedValue(999);

    const result = await svc.getDashboardStats();
    expect(result.totals.users).toBe(100);
    expect(result.totals.animes).toBe(50);
    expect(result.totals.episodes).toBe(400);
    expect(result.totals.comments).toBe(20);
    expect(result.totals.posts).toBe(10);
    expect(result.totals.ratings).toBe(600);
    expect(result.totals.favorites).toBe(120);
    expect(result.totals.watchHistories).toBe(999);
    expect(result.moderation.pendingReports).toBe(4);
    expect(result.moderation.suspendedUsers).toBe(2);
    expect(result.moderation.pendingFeedbacks).toBe(2);
    expect(result.moderation.pendingAnimeRequests).toBe(3);
    expect(result.weekly.newUsers).toBe(5);
    expect(result.weekly.newPosts).toBe(0);
    expect(result.weekly.newComments).toBe(1);
    expect(result.admins).toBe(3);
  });
});
