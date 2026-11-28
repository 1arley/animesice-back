import { BadRequestException } from '@nestjs/common';
import {
  AdminNotificationAudience,
  AdminNotificationCategory,
} from '@prisma/client';
import { AdminNotificationService } from '@/notification/admin-notification.service';
import type { SendAdminNotificationDto } from '@/notification/dto/send-admin-notification.dto';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const DEDUPE_KEY = '44444444-4444-4444-8444-444444444444';

function makePrisma() {
  const adminNotification = {
    create: jest.fn(async () => ({ id: 'campaign-1' })) as jest.Mock,
    update: jest.fn(async () => ({ id: 'campaign-1' })) as jest.Mock,
    findFirst: jest.fn(async () => null) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const notification = {
    createMany: jest.fn(async () => ({ count: 1 })) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const user = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  return {
    adminNotification,
    notification,
    user,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

function buildDto(
  overrides: Partial<SendAdminNotificationDto> = {},
): SendAdminNotificationDto {
  return {
    audience: AdminNotificationAudience.SINGLE,
    userIds: [USER_ID],
    category: AdminNotificationCategory.THANKS,
    title: 'Obrigado pelo feedback',
    body: 'Sua sugestão entrou no roadmap.',
    dedupeKey: DEDUPE_KEY,
    ...overrides,
  };
}

describe('AdminNotificationService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new AdminNotificationService(prisma as never);
    return { svc, prisma };
  }

  it('exige confirmação explícita no envio global', async () => {
    const { svc, prisma } = build();

    await expect(
      svc.send(
        ADMIN_ID,
        buildDto({
          audience: AdminNotificationAudience.GLOBAL,
          userIds: undefined,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.adminNotification.create).not.toHaveBeenCalled();
  });

  it('rejeita envio para grupo sem destinatários', async () => {
    const { svc } = build();

    await expect(
      svc.send(
        ADMIN_ID,
        buildDto({
          audience: AdminNotificationAudience.SELECTED,
          userIds: [],
        }),
      ),
    ).rejects.toThrow('Selecione ao menos um destinatário.');
  });

  it('rejeita destinatário inexistente', async () => {
    const { svc, prisma } = build();
    prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);

    await expect(
      svc.send(
        ADMIN_ID,
        buildDto({
          audience: AdminNotificationAudience.SELECTED,
          userIds: [USER_ID, OTHER_ID],
        }),
      ),
    ).rejects.toThrow('Um ou mais destinatários não existem.');
  });

  it('retorna o envio original quando a chave de idempotência já existe', async () => {
    const { svc, prisma } = build();
    prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
    prisma.adminNotification.findFirst.mockResolvedValue({
      id: 'campaign-existing',
      recipientCount: 1,
    });

    const result = await svc.send(ADMIN_ID, buildDto());

    expect(result).toEqual(
      expect.objectContaining({ id: 'campaign-existing', duplicate: true }),
    );
    expect(prisma.adminNotification.create).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('envia individualmente como SYSTEM com a categoria do comunicado', async () => {
    const { svc, prisma } = build();
    prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
    prisma.adminNotification.create.mockResolvedValue({
      id: 'campaign-1',
      admin: { id: ADMIN_ID },
    });
    prisma.adminNotification.update.mockResolvedValue({
      id: 'campaign-1',
      recipientCount: 1,
      admin: { id: ADMIN_ID },
    });

    const result = await svc.send(ADMIN_ID, buildDto());

    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: USER_ID,
          type: 'SYSTEM',
          adminNotificationId: 'campaign-1',
          adminCategory: AdminNotificationCategory.THANKS,
          linkUrl: null,
        }),
      ],
    });
    expect(prisma.adminNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { recipientCount: 1 } }),
    );
    expect(result).toEqual(
      expect.objectContaining({ recipientCount: 1, duplicate: false }),
    );
  });

  it('processa o envio global em lotes até esgotar os usuários', async () => {
    const { svc, prisma } = build();
    prisma.adminNotification.create.mockResolvedValue({
      id: 'campaign-global',
      admin: { id: ADMIN_ID },
    });
    prisma.adminNotification.update.mockResolvedValue({
      id: 'campaign-global',
      recipientCount: 3,
      admin: { id: ADMIN_ID },
    });
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: USER_ID }, { id: OTHER_ID }])
      .mockResolvedValueOnce([{ id: '55555555-5555-4555-8555-555555555555' }])
      .mockResolvedValueOnce([]);

    const result = await svc.send(
      ADMIN_ID,
      buildDto({
        audience: AdminNotificationAudience.GLOBAL,
        userIds: undefined,
        confirmGlobal: true,
      }),
    );

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: { gt: OTHER_ID } } }),
    );
    expect(result).toEqual(
      expect.objectContaining({ recipientCount: 3, duplicate: false }),
    );
  });
});
