import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

describe('SettingsController', () => {
  let controller: SettingsController;

  const mockSettingsService = {
    getAccountSettings: jest.fn(),
    changeEmail: jest.fn(),
    confirmEmailChange: jest.fn(),
    changePassword: jest.fn(),
    updateProfile: jest.fn(),
    getPrivacySettings: jest.fn(),
    updatePrivacySettings: jest.fn(),
    getNotificationPreferences: jest.fn(),
    updateNotificationPreference: jest.fn(),
    getSiteSettings: jest.fn(),
    updateSiteSettings: jest.fn(),
    listUsersForAdmin: jest.fn(),
    getUserDetailForAdmin: jest.fn(),
    deleteUser: jest.fn(),
    updateUserRole: jest.fn(),
    getDashboardStats: jest.fn(),
  };

  const req = (role: string = 'USER') =>
    ({ user: { id: 'user-1', role } }) as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: mockSettingsService }],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
  });

  describe('conta', () => {
    it('getAccountSettings', async () => {
      mockSettingsService.getAccountSettings.mockResolvedValue({
        email: 'a@b.c',
      });
      const result = await controller.getAccountSettings(req());
      expect(result).toEqual({ email: 'a@b.c' });
      expect(mockSettingsService.getAccountSettings).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('requestEmailChange', async () => {
      mockSettingsService.changeEmail.mockResolvedValue({ ok: true });
      const dto = { newEmail: 'novo@b.c', password: '123' };
      await controller.requestEmailChange(req(), dto);
      expect(mockSettingsService.changeEmail).toHaveBeenCalledWith(
        'user-1',
        'novo@b.c',
        '123',
      );
    });

    it('confirmEmailChange', async () => {
      mockSettingsService.confirmEmailChange.mockResolvedValue({ ok: true });
      const dto = { token: 'token-x' };
      await controller.confirmEmailChange(dto);
      expect(mockSettingsService.confirmEmailChange).toHaveBeenCalledWith(
        'token-x',
      );
    });

    it('changePassword', async () => {
      mockSettingsService.changePassword.mockResolvedValue({ ok: true });
      const dto = { currentPassword: 'old', newPassword: 'new' };
      await controller.changePassword(req(), dto);
      expect(mockSettingsService.changePassword).toHaveBeenCalledWith(
        'user-1',
        'old',
        'new',
      );
    });

    it('updateProfile', async () => {
      mockSettingsService.updateProfile.mockResolvedValue({ name: 'X' });
      const dto = { name: 'X', userName: 'x' };
      await controller.updateProfile(req(), dto);
      expect(mockSettingsService.updateProfile).toHaveBeenCalledWith(
        'user-1',
        'X',
        'x',
      );
    });
  });

  describe('privacidade', () => {
    it('getPrivacySettings', async () => {
      mockSettingsService.getPrivacySettings.mockResolvedValue({
        showEmail: false,
      });
      await controller.getPrivacySettings(req());
      expect(mockSettingsService.getPrivacySettings).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('updatePrivacySettings', async () => {
      const dto = { showEmail: true };
      await controller.updatePrivacySettings(req(), dto as any);
      expect(mockSettingsService.updatePrivacySettings).toHaveBeenCalledWith(
        'user-1',
        dto,
      );
    });
  });

  describe('notificações', () => {
    it('getNotificationPreferences', async () => {
      mockSettingsService.getNotificationPreferences.mockResolvedValue([]);
      await controller.getNotificationPreferences(req());
      expect(
        mockSettingsService.getNotificationPreferences,
      ).toHaveBeenCalledWith('user-1');
    });

    it('updateNotificationPreference', async () => {
      const dto = { typeId: 't1', channel: 'EMAIL', enabled: true };
      await controller.updateNotificationPreference(req(), dto as any);
      expect(
        mockSettingsService.updateNotificationPreference,
      ).toHaveBeenCalledWith('user-1', 't1', 'EMAIL', true);
    });
  });

  describe('site settings', () => {
    it('getSiteSettings', async () => {
      mockSettingsService.getSiteSettings.mockResolvedValue({ siteName: 'X' });
      const result = await controller.getSiteSettings();
      expect(result).toEqual({ siteName: 'X' });
    });

    it('updateSiteSettings', async () => {
      const dto = { siteName: 'Y' };
      await controller.updateSiteSettings(dto);
      expect(mockSettingsService.updateSiteSettings).toHaveBeenCalledWith(dto);
    });
  });

  describe('admin users', () => {
    it('listUsersForAdmin com defaults', async () => {
      mockSettingsService.listUsersForAdmin.mockResolvedValue([]);
      await controller.listUsersForAdmin('', '', undefined);
      expect(mockSettingsService.listUsersForAdmin).toHaveBeenCalledWith(
        1,
        20,
        undefined,
      );
    });

    it('listUsersForAdmin com filtros', async () => {
      mockSettingsService.listUsersForAdmin.mockResolvedValue([]);
      await controller.listUsersForAdmin('2', '50', 'test');
      expect(mockSettingsService.listUsersForAdmin).toHaveBeenCalledWith(
        2,
        50,
        'test',
      );
    });

    it('getUserDetailForAdmin', async () => {
      mockSettingsService.getUserDetailForAdmin.mockResolvedValue({ id: 'u1' });
      const result = await controller.getUserDetailForAdmin('u1');
      expect(result).toEqual({ id: 'u1' });
    });

    it('deleteUser', async () => {
      mockSettingsService.deleteUser.mockResolvedValue({ deleted: true });
      await controller.deleteUser(req('ADMIN'), 'u2');
      expect(mockSettingsService.deleteUser).toHaveBeenCalledWith(
        'u2',
        'user-1',
      );
    });

    it('updateUserRole', async () => {
      mockSettingsService.updateUserRole.mockResolvedValue({
        id: 'u2',
        role: 'ADMIN',
      });
      await controller.updateUserRole(req('SUPERADMIN'), 'u2', {
        role: 'ADMIN',
      });
      expect(mockSettingsService.updateUserRole).toHaveBeenCalledWith(
        'u2',
        'ADMIN',
        'user-1',
        'SUPERADMIN',
      );
    });
  });

  describe('dashboard', () => {
    it('getDashboardStats', async () => {
      mockSettingsService.getDashboardStats.mockResolvedValue({ animes: 100 });
      const result = await controller.getDashboardStats();
      expect(result).toEqual({ animes: 100 });
    });
  });
});
