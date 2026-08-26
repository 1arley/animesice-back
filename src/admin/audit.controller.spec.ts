import { Test } from '@nestjs/testing';
import { AuditController } from '@/admin/audit.controller';
import { AuditService } from '@/common/services/audit.service';

describe('AuditController', () => {
  let controller: AuditController;
  const auditService = { getSensitiveDataAccess: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    auditService.getSensitiveDataAccess.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: auditService }],
    }).compile();
    controller = moduleRef.get(AuditController);
  });

  it('usa valores padrão (resourceType User, 7 dias) quando nada é informado', async () => {
    await controller.getSensitiveDataAccess();

    expect(auditService.getSensitiveDataAccess).toHaveBeenCalledWith('User', 7);
  });

  it('passa resourceType e dias informados', async () => {
    await controller.getSensitiveDataAccess('Comment', '30');

    expect(auditService.getSensitiveDataAccess).toHaveBeenCalledWith(
      'Comment',
      30,
    );
  });

  it('limita dias a 90', async () => {
    await controller.getSensitiveDataAccess('User', '500');

    expect(auditService.getSensitiveDataAccess).toHaveBeenCalledWith(
      'User',
      90,
    );
  });

  it('usa 7 dias quando o valor informado é inválido', async () => {
    await controller.getSensitiveDataAccess('User', 'abc');

    expect(auditService.getSensitiveDataAccess).toHaveBeenCalledWith('User', 7);
  });

  it('retorna os logs retornados pelo serviço', async () => {
    const logs = [{ id: 'log-1' }];
    auditService.getSensitiveDataAccess.mockResolvedValue(logs);

    await expect(
      controller.getSensitiveDataAccess('User', '7'),
    ).resolves.toEqual(logs);
  });
});
