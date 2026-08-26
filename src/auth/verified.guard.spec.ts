import { ForbiddenException } from '@nestjs/common';
import { VerifiedGuard } from '@/auth/verified.guard';

describe('VerifiedGuard', () => {
  let guard: VerifiedGuard;

  function buildContext(user?: any): any {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  }

  beforeEach(() => {
    guard = new VerifiedGuard();
  });

  it('permite acesso para usuário verificado', () => {
    expect(
      guard.canActivate(buildContext({ id: 'u1', isVerified: true })),
    ).toBe(true);
  });

  it('lança ForbiddenException quando não há usuário', () => {
    expect(() => guard.canActivate(buildContext())).toThrow(ForbiddenException);
  });

  it('lança ForbiddenException quando o usuário não é verificado', () => {
    expect(() =>
      guard.canActivate(buildContext({ id: 'u1', isVerified: false })),
    ).toThrow(ForbiddenException);
  });

  it('lança ForbiddenException com mensagem descritiva de conta não verificada', () => {
    try {
      guard.canActivate(buildContext({ id: 'u1', isVerified: false }));
      fail('deveria ter lançado');
    } catch (e: unknown) {
      expect((e as ForbiddenException).message).toBe(
        'Conta não verificada. Verifique seu email para continuar.',
      );
    }
  });
});
