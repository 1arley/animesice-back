import { of, throwError, lastValueFrom } from 'rxjs';
import { AuditInterceptor } from '@/common/interceptors/audit.interceptor';
import { AuditMetadata } from '@/auth/decorators/audit.decorator';

describe('AuditInterceptor', () => {
  let reflector: any;
  let auditService: any;
  let interceptor: AuditInterceptor;

  const AUDIT_META: AuditMetadata = {
    action: 'VIEW_USER',
    resourceType: 'User',
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    auditService = {
      logRequest: jest.fn().mockResolvedValue(undefined),
      logError: jest.fn().mockResolvedValue(undefined),
    };
    interceptor = new AuditInterceptor(reflector, auditService);
  });

  afterEach(() => jest.clearAllMocks());

  function buildContext(user?: Record<string, unknown>): any {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => (user !== undefined ? { user } : ({} as any)),
      }),
    } as any;
  }

  function makeNext(response: unknown) {
    return { handle: () => of(response) };
  }

  it('passa adiante quando não há metadados de auditoria', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const next = { handle: jest.fn(() => of('ok')) };

    await expect(
      lastValueFrom(interceptor.intercept(buildContext({}), next as any)),
    ).resolves.toBe('ok');
    expect(auditService.logRequest).not.toHaveBeenCalled();
  });

  it('passa adiante sem auditar quando não há usuário autenticado', async () => {
    reflector.getAllAndOverride.mockReturnValue(AUDIT_META);

    await expect(
      lastValueFrom(
        interceptor.intercept(buildContext(), makeNext('ok') as any),
      ),
    ).resolves.toBe('ok');
    expect(auditService.logRequest).not.toHaveBeenCalled();
  });

  it('conta registros em resposta array', async () => {
    reflector.getAllAndOverride.mockReturnValue(AUDIT_META);
    const user = { id: 'admin-1' };

    await lastValueFrom(
      interceptor.intercept(
        buildContext(user),
        makeNext([{ id: 1 }, { id: 2 }]) as any,
      ),
    );

    expect(auditService.logRequest).toHaveBeenCalledWith(
      'admin-1',
      'VIEW_USER',
      'User',
      expect.anything(),
      undefined,
      2,
    );
  });

  it('conta registros em payload.data', async () => {
    reflector.getAllAndOverride.mockReturnValue(AUDIT_META);

    await lastValueFrom(
      interceptor.intercept(
        buildContext({ id: 'admin-1' }),
        makeNext({ data: [{ id: 1 }] }) as any,
      ),
    );

    expect(auditService.logRequest).toHaveBeenCalledWith(
      'admin-1',
      'VIEW_USER',
      'User',
      expect.anything(),
      undefined,
      1,
    );
  });

  it('conta registros em payload.meta.total', async () => {
    reflector.getAllAndOverride.mockReturnValue(AUDIT_META);

    await lastValueFrom(
      interceptor.intercept(
        buildContext({ id: 'admin-1' }),
        makeNext({ meta: { total: 42 } }) as any,
      ),
    );

    expect(auditService.logRequest).toHaveBeenCalledWith(
      'admin-1',
      'VIEW_USER',
      'User',
      expect.anything(),
      undefined,
      42,
    );
  });

  it('conta 1 para respostas simples em objeto', async () => {
    reflector.getAllAndOverride.mockReturnValue(AUDIT_META);

    await lastValueFrom(
      interceptor.intercept(
        buildContext({ id: 'admin-1' }),
        makeNext({ id: 1 }) as any,
      ),
    );

    expect(auditService.logRequest).toHaveBeenCalledWith(
      'admin-1',
      'VIEW_USER',
      'User',
      expect.anything(),
      undefined,
      1,
    );
  });

  it('conta 0 para respostas não-objeto (string/null)', async () => {
    reflector.getAllAndOverride.mockReturnValue(AUDIT_META);

    await lastValueFrom(
      interceptor.intercept(
        buildContext({ id: 'admin-1' }),
        makeNext('string-response') as any,
      ),
    );

    expect(auditService.logRequest).toHaveBeenCalledWith(
      'admin-1',
      'VIEW_USER',
      'User',
      expect.anything(),
      undefined,
      0,
    );
  });

  it('loga erro e o reemite ao handler', async () => {
    reflector.getAllAndOverride.mockReturnValue(AUDIT_META);
    const error = new Error('boom');
    const next = { handle: () => throwError(() => error) };

    await expect(
      lastValueFrom(
        interceptor.intercept(buildContext({ id: 'admin-1' }), next as any),
      ),
    ).rejects.toBe(error);

    expect(auditService.logError).toHaveBeenCalledWith(
      'admin-1',
      'VIEW_USER',
      'User',
      expect.anything(),
      error,
    );
  });

  it('não propaga falha ao gravar auditoria de sucesso', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    reflector.getAllAndOverride.mockReturnValue(AUDIT_META);
    auditService.logRequest.mockRejectedValue(new Error('db down'));

    await expect(
      lastValueFrom(
        interceptor.intercept(
          buildContext({ id: 'admin-1' }),
          makeNext({ ok: true }) as any,
        ),
      ),
    ).resolves.toEqual({ ok: true });

    expect(errorSpy).toHaveBeenCalledWith(
      'Audit log failed:',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it('não propaga falha ao gravar auditoria de erro', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    reflector.getAllAndOverride.mockReturnValue(AUDIT_META);
    auditService.logError.mockRejectedValue(new Error('db down'));

    const error = new Error('boom');
    await expect(
      lastValueFrom(
        interceptor.intercept(buildContext({ id: 'admin-1' }), {
          handle: () => throwError(() => error),
        } as any),
      ),
    ).rejects.toBe(error);

    expect(errorSpy).toHaveBeenCalledWith(
      'Audit error log failed:',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
