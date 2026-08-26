import { AuditService } from '@/common/services/audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: any;

  const baseInput = {
    adminId: 'admin-1',
    action: 'VIEW_USER',
    resourceType: 'User',
    ipAddress: '127.0.0.1',
  };

  beforeEach(() => {
    prisma = {
      adminAuditLog: { create: jest.fn(), findMany: jest.fn() },
    };
    service = new AuditService(prisma);
  });

  afterEach(() => jest.clearAllMocks());

  describe('log', () => {
    it('grava log com status SUCCESS por padrão', async () => {
      prisma.adminAuditLog.create.mockResolvedValue({ id: '1' });

      await service.log(baseInput);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminId: 'admin-1',
          status: 'SUCCESS',
        }),
      });
    });

    it('grava log com status FAILED e mensagem de erro', async () => {
      prisma.adminAuditLog.create.mockResolvedValue({});

      await service.log({
        ...baseInput,
        status: 'FAILED',
        errorMessage: 'boom',
      } as any);

      const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
      expect(data.status).toBe('FAILED');
      expect(data.errorMessage).toBe('boom');
    });

    it('inclui resourceId e dataAccessed quando informados', async () => {
      prisma.adminAuditLog.create.mockResolvedValue({});

      await service.log({
        ...baseInput,
        resourceId: 'res-1',
        dataAccessed: 10,
      });

      const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
      expect(data.resourceId).toBe('res-1');
      expect(data.dataAccessed).toBe(10);
    });

    it('não lança erro quando a gravação falha', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      prisma.adminAuditLog.create.mockRejectedValue(new Error('db down'));

      await expect(service.log(baseInput as any)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('logRequest', () => {
    it('usa o primeiro IP de x-forwarded-for e o user-agent', async () => {
      const req = {
        get: jest.fn((h: string) =>
          h === 'x-forwarded-for'
            ? '203.0.113.1, 10.0.0.2'
            : h === 'user-agent'
              ? 'curl/8'
              : undefined,
        ),
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      await service.logRequest('admin-1', 'VIEW_USER', 'User', req, 'res-1', 3);

      const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
      expect(data.ipAddress).toBe('203.0.113.1');
      expect(data.userAgent).toBe('curl/8');
      expect(data.resourceId).toBe('res-1');
      expect(data.dataAccessed).toBe(3);
    });

    it('usa req.ip quando não há x-forwarded-for', async () => {
      const req = {
        get: jest.fn(() => undefined),
        ip: '10.0.0.5',
        socket: { remoteAddress: 'x' },
      } as any;

      await service.logRequest('admin-1', 'VIEW_USER', 'User', req);

      const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
      expect(data.ipAddress).toBe('10.0.0.5');
    });

    it('usa socket.remoteAddress quando não há req.ip', async () => {
      const req = {
        get: jest.fn(() => undefined),
        socket: { remoteAddress: '192.168.0.1' },
      } as any;

      await service.logRequest('admin-1', 'VIEW_USER', 'User', req);

      const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
      expect(data.ipAddress).toBe('192.168.0.1');
    });

    it('usa "unknown" quando nenhum IP está disponível', async () => {
      const req = {
        get: jest.fn(() => undefined),
        socket: {},
      } as any;

      await service.logRequest('admin-1', 'VIEW_USER', 'User', req);

      const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
      expect(data.ipAddress).toBe('unknown');
    });
  });

  describe('logError', () => {
    it('grava log FAILED com a mensagem do erro', async () => {
      const req = {
        get: jest.fn(() => undefined),
        ip: '1.2.3.4',
        socket: {},
      } as any;

      await service.logError(
        'admin-1',
        'VIEW_USER',
        'User',
        req,
        new Error('acesso negado'),
      );

      const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
      expect(data.status).toBe('FAILED');
      expect(data.errorMessage).toBe('acesso negado');
      expect(data.ipAddress).toBe('1.2.3.4');
    });
  });

  describe('getAdminActivity', () => {
    it('busca atividades do admin com limite informado', async () => {
      const logs = [{ id: '1' }];
      prisma.adminAuditLog.findMany.mockResolvedValue(logs);

      const result = await service.getAdminActivity('admin-1', 10);

      expect(result).toEqual(logs);
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
        where: { adminId: 'admin-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });

    it('usa limite padrão de 50', async () => {
      prisma.adminAuditLog.findMany.mockResolvedValue([]);

      await service.getAdminActivity('admin-1');

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });

  describe('getSensitiveDataAccess', () => {
    it('busca acessos sensíveis filtrando por resourceType e ações', async () => {
      const logs = [{ id: '1', action: 'VIEW_USER' }];
      prisma.adminAuditLog.findMany.mockResolvedValue(logs);

      const result = await service.getSensitiveDataAccess('User', 7);

      expect(result).toEqual(logs);
      const call = prisma.adminAuditLog.findMany.mock.calls[0][0];
      expect(call.where.resourceType).toBe('User');
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);
      expect(call.where.action).toEqual({
        in: ['LIST_USERS', 'VIEW_USER', 'LIST_EMAILS'],
      });
      expect(call.include.admin.select).toEqual({
        id: true,
        email: true,
        name: true,
        role: true,
      });
    });

    it('usa resourceType e dias padrão (User, 7)', async () => {
      prisma.adminAuditLog.findMany.mockResolvedValue([]);

      await service.getSensitiveDataAccess();

      const call = prisma.adminAuditLog.findMany.mock.calls[0][0];
      expect(call.where.resourceType).toBe('User');

      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - 7);
      const since = call.where.createdAt.gte as Date;
      expect(since.toISOString().slice(0, 10)).toBe(
        expectedDate.toISOString().slice(0, 10),
      );
    });
  });
});
