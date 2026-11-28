import { AdminNotificationController } from '@/notification/admin-notification.controller';
import {
  AdminNotificationAudience,
  AdminNotificationCategory,
} from '@prisma/client';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import type { SendAdminNotificationDto } from '@/notification/dto/send-admin-notification.dto';

const REQ = {
  user: { id: 'admin-1' },
} as unknown as AuthenticatedRequest;

function build() {
  const service = {
    searchRecipients: jest.fn(async () => ({ data: [], meta: {} })),
    countGlobalAudience: jest.fn(async () => ({ count: 10 })),
    listHistory: jest.fn(async () => ({ data: [], meta: {} })),
    getCampaign: jest.fn(async () => ({ id: 'campaign-1' })),
    send: jest.fn(async () => ({ id: 'campaign-1', recipientCount: 3 })),
  };
  const audit = {
    logRequest: jest.fn(async () => undefined),
    logError: jest.fn(async () => undefined),
  };
  const controller = new AdminNotificationController(
    service as never,
    audit as never,
  );
  return { controller, service, audit };
}

describe('AdminNotificationController', () => {
  it('aplica defaults de paginação na busca de destinatários', () => {
    const { controller, service } = build();

    void controller.searchRecipients(undefined, undefined, undefined);
    expect(service.searchRecipients).toHaveBeenCalledWith(undefined, 1, 20);

    void controller.searchRecipients('ana', '2', '50');
    expect(service.searchRecipients).toHaveBeenLastCalledWith('ana', 2, 50);

    void controller.searchRecipients('ana', 'abc', '0');
    expect(service.searchRecipients).toHaveBeenLastCalledWith('ana', 1, 20);
  });

  it('expõe a contagem global do público', async () => {
    const { controller } = build();

    await expect(controller.countGlobalAudience()).resolves.toEqual({
      count: 10,
    });
  });

  it('repassa filtros do histórico com defaults', () => {
    const { controller, service } = build();

    void controller.listHistory(undefined, undefined, undefined, undefined);
    expect(service.listHistory).toHaveBeenCalledWith(1, 20, {
      category: undefined,
      search: undefined,
    });

    void controller.listHistory(
      '2',
      '50',
      AdminNotificationCategory.THANKS,
      'feedback',
    );
    expect(service.listHistory).toHaveBeenLastCalledWith(2, 50, {
      category: AdminNotificationCategory.THANKS,
      search: 'feedback',
    });
  });

  it('repassa paginação do detalhe da campanha', () => {
    const { controller, service } = build();

    void controller.getCampaign('campaign-1', undefined, undefined);
    expect(service.getCampaign).toHaveBeenCalledWith('campaign-1', 1, 20);

    void controller.getCampaign('campaign-2', '3', '100');
    expect(service.getCampaign).toHaveBeenLastCalledWith('campaign-2', 3, 100);
  });

  it('envia e audita o sucesso com o número de destinatários', async () => {
    const { controller, service, audit } = build();
    const dto = {
      audience: AdminNotificationAudience.SINGLE,
      userIds: ['22222222-2222-4222-8222-222222222222'],
      category: AdminNotificationCategory.THANKS,
      title: 'Obrigado',
      body: 'Mensagem',
      dedupeKey: '44444444-4444-4444-8444-444444444444',
    } as SendAdminNotificationDto;

    await expect(controller.send(REQ, dto)).resolves.toEqual({
      id: 'campaign-1',
      recipientCount: 3,
    });
    expect(service.send).toHaveBeenCalledWith('admin-1', dto);
    expect(audit.logRequest).toHaveBeenCalledWith(
      'admin-1',
      'SEND_NOTIFICATION',
      'AdminNotification',
      REQ,
      'campaign-1',
      3,
    );
  });

  it('audita falhas de envio e propaga o erro', async () => {
    const { controller, service, audit } = build();
    const failure = new Error('db unavailable');
    service.send.mockRejectedValueOnce(failure);
    const dto = {
      audience: AdminNotificationAudience.GLOBAL,
      category: AdminNotificationCategory.GENERAL,
      title: 'Comunicado',
      body: 'Mensagem',
      dedupeKey: '44444444-4444-4444-8444-444444444444',
      confirmGlobal: true,
    } as SendAdminNotificationDto;

    await expect(controller.send(REQ, dto)).rejects.toBe(failure);
    expect(audit.logError).toHaveBeenCalledWith(
      'admin-1',
      'SEND_NOTIFICATION',
      'AdminNotification',
      REQ,
      failure,
    );
    expect(audit.logRequest).not.toHaveBeenCalled();
  });
});
