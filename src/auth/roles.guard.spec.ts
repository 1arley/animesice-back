import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '@/auth/roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: any;

  function buildContext(user?: any): any {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector);
  });

  it('permite acesso quando não há roles exigidas', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(buildContext({ role: 'USER' }))).toBe(true);
  });

  it('lança ForbiddenException quando roles retornam array vazio', () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    expect(() => guard.canActivate(buildContext({ role: 'USER' }))).toThrow(
      ForbiddenException,
    );
  });

  it('lança ForbiddenException quando não há usuário autenticado', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);

    expect(() => guard.canActivate(buildContext())).toThrow(ForbiddenException);
  });

  it('permite quando o usuário tem uma das roles exigidas', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'SUPERADMIN']);

    expect(guard.canActivate(buildContext({ role: 'ADMIN' }))).toBe(true);
  });

  it('permite quando o usuário tem a segunda role da lista', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'SUPERADMIN']);

    expect(guard.canActivate(buildContext({ role: 'SUPERADMIN' }))).toBe(true);
  });

  it('lança ForbiddenException quando o usuário não tem nenhuma role exigida', () => {
    reflector.getAllAndOverride.mockReturnValue(['SUPERADMIN']);

    expect(() => guard.canActivate(buildContext({ role: 'USER' }))).toThrow(
      ForbiddenException,
    );
  });

  it('lança ForbiddenException com mensagem descritiva', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);

    try {
      guard.canActivate(buildContext({ role: 'USER' }));
      fail('deveria ter lançado');
    } catch (e: unknown) {
      expect((e as ForbiddenException).message).toBe(
        'Você não tem permissão para acessar este recurso.',
      );
    }
  });
});
