import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController } from '@/notification/notification.controller';
import { NotificationService } from '@/notification/notification.service';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('NotificationController', () => {
  let controller: NotificationController;
  let notificationService: NotificationService;

  const mockNotificationService = {
    list: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    getPreferences: jest.fn(),
    updatePreference: jest.fn(),
  };

  const req = {
    user: { id: 'user-1', email: 'a@b.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    controller = module.get<NotificationController>(NotificationController);
    notificationService = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve listar notificações com parse de page/limit/unread', async () => {
    await controller.list(req, '2', '10', 'true');
    expect(notificationService.list).toHaveBeenCalledWith(
      'user-1',
      2,
      10,
      true,
    );
  });

  it('deve usar padrões quando parâmetros ausentes', async () => {
    await controller.list(
      req,
      undefined as any,
      undefined as any,
      undefined as any,
    );
    expect(notificationService.list).toHaveBeenCalledWith(
      'user-1',
      1,
      20,
      false,
    );
  });

  it('deve marcar notificação como lida', async () => {
    mockNotificationService.markAsRead.mockResolvedValue({
      id: 'n1',
      read: true,
    });
    const result = await controller.markAsRead(req, 'n1');
    expect(result).toHaveProperty('read', true);
    expect(notificationService.markAsRead).toHaveBeenCalledWith('user-1', 'n1');
  });

  it('deve marcar todas como lidas', async () => {
    mockNotificationService.markAllAsRead.mockResolvedValue({ message: 'ok' });
    const result = await controller.markAllAsRead(req);
    expect(result).toEqual({ message: 'ok' });
    expect(notificationService.markAllAsRead).toHaveBeenCalledWith('user-1');
  });

  it('deve listar preferências', async () => {
    mockNotificationService.getPreferences.mockResolvedValue([]);
    const result = await controller.getPreferences(req);
    expect(result).toEqual([]);
    expect(notificationService.getPreferences).toHaveBeenCalledWith('user-1');
  });

  it('deve atualizar preferência', async () => {
    mockNotificationService.updatePreference.mockResolvedValue({ id: 'p1' });
    const body = {
      typeId: NotificationType.SYSTEM,
      channel: NotificationChannel.IN_APP,
      enabled: false,
    };
    const result = await controller.updatePreference(req, body);
    expect(result).toEqual({ id: 'p1' });
    expect(notificationService.updatePreference).toHaveBeenCalledWith(
      'user-1',
      NotificationType.SYSTEM,
      NotificationChannel.IN_APP,
      false,
    );
  });

  it('deve propagar erro ao marcar como lida', async () => {
    mockNotificationService.markAsRead.mockRejectedValue(new Error('boom'));
    await expect(controller.markAsRead(req, 'x')).rejects.toThrow('boom');
  });
});
