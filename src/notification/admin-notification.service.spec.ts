import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AdminNotificationAudience,
  AdminNotificationCategory,
  Prisma,
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

  it('rejeita mais de 500 destinatários em um envio de grupo', async () => {
    const { svc, prisma } = build();
    const userIds = Array.from({ length: 501 }, (_, index) => `user-${index}`);

    await expect(
      svc.send(
        ADMIN_ID,
        buildDto({
          audience: AdminNotificationAudience.SELECTED,
          userIds,
        }),
      ),
    ).rejects.toThrow('Envie para no máximo 500 jogadores por vez.');
    expect(prisma.adminNotification.create).not.toHaveBeenCalled();
  });

  it('devolve a campanha vencedora quando duas requisições usam a mesma chave', async () => {
    const { svc, prisma } = build();
    prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
    prisma.adminNotification.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'campaign-winner', recipientCount: 1 });
    prisma.adminNotification.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );

    const result = await svc.send(ADMIN_ID, buildDto());

    expect(result).toEqual(
      expect.objectContaining({ id: 'campaign-winner', duplicate: true }),
    );
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('preserva a contagem parcial e propaga falha de entrega', async () => {
    const { svc, prisma } = build();
    prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
    prisma.adminNotification.create.mockResolvedValue({
      id: 'campaign-1',
      admin: { id: ADMIN_ID },
    });
    prisma.notification.createMany.mockRejectedValue(new Error('db down'));

    await expect(svc.send(ADMIN_ID, buildDto())).rejects.toThrow('db down');
    expect(prisma.adminNotification.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { recipientCount: 0 },
    });
  });

  it('rejeita envio individual com mais de um destinatário', async () => {
    const { svc } = build();

    await expect(
      svc.send(ADMIN_ID, buildDto({ userIds: [USER_ID, OTHER_ID] })),
    ).rejects.toThrow('Envio individual aceita exatamente um destinatário.');
  });

  describe('consultas', () => {
    it('conta o público global', async () => {
      const { svc, prisma } = build();
      prisma.user.count.mockResolvedValue(1234);

      await expect(svc.countGlobalAudience()).resolves.toEqual({ count: 1234 });
    });

    it('busca destinatários com paginação e limite preservado', async () => {
      const { svc, prisma } = build();
      prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
      prisma.user.count.mockResolvedValue(1);

      const result = await svc.searchRecipients('  viewer  ', 1, 999);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          where: {
            OR: expect.arrayContaining([
              { userName: { contains: 'viewer', mode: 'insensitive' } },
            ]),
          },
        }),
      );
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      });
    });

    it('só compara id quando a busca é um UUID', async () => {
      const { svc, prisma } = build();

      await svc.searchRecipients(USER_ID);
      expect(prisma.user.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { OR: expect.arrayContaining([{ id: USER_ID }]) },
        }),
      );

      await svc.searchRecipients('viewer');
      const lastCall = prisma.user.findMany.mock.calls.at(-1)?.[0];
      expect(lastCall.where.OR).not.toContainEqual({ id: 'viewer' });
    });

    it('lista o histórico com filtros de categoria e texto', async () => {
      const { svc, prisma } = build();
      prisma.adminNotification.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.adminNotification.count.mockResolvedValue(1);

      const result = await svc.listHistory(1, 20, {
        category: AdminNotificationCategory.THANKS,
        search: ' obrigado ',
      });

      expect(prisma.adminNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            category: AdminNotificationCategory.THANKS,
            OR: expect.arrayContaining([
              { title: { contains: 'obrigado', mode: 'insensitive' } },
            ]),
          },
        }),
      );
      expect(result.meta.total).toBe(1);
    });

    it('lança 404 quando a campanha não existe', async () => {
      const { svc } = build();

      await expect(svc.getCampaign('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('devolve campanha com destinatários paginados', async () => {
      const { svc, prisma } = build();
      prisma.adminNotification.findUnique.mockResolvedValue({
        id: 'campaign-1',
      });
      prisma.notification.findMany.mockResolvedValue([
        { id: 'n1', user: { id: USER_ID } },
      ]);
      prisma.notification.count.mockResolvedValue(1);

      const result = await svc.getCampaign('campaign-1', 2, 999);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { adminNotificationId: 'campaign-1' },
          skip: 100,
          take: 100,
        }),
      );
      expect(result.recipients.meta).toEqual({
        total: 1,
        page: 2,
        limit: 100,
        totalPages: 1,
      });
    });
  });
});
