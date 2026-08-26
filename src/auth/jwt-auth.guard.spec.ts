import { JwtAuthGuard } from '@/auth/jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: any;
  let superCanActivateSpy: jest.SpyInstance;

  function buildContext(): any {
    return { getHandler: () => ({}), getClass: () => ({}) } as any;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    superCanActivateSpy = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockReturnValue(true);
    guard = new JwtAuthGuard(reflector);
  });

  afterEach(() => {
    superCanActivateSpy.mockRestore();
  });

  it('permite acesso sem verificar JWT quando a rota é pública', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(guard.canActivate(buildContext())).toBe(true);
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });

  it('delega para o AuthGuard pai quando a rota não é pública', () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    expect(guard.canActivate(buildContext())).toBe(true);
    expect(superCanActivateSpy).toHaveBeenCalledTimes(1);
  });

  it('delega para o AuthGuard quando não há marcação pública (undefined)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(buildContext())).toBe(true);
    expect(superCanActivateSpy).toHaveBeenCalledTimes(1);
  });

  it('chama o Reflect metadata IS_PUBLIC_KEY', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    void guard.canActivate(buildContext());

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
      expect.any(Object),
      expect.any(Object),
    ]);
  });
});
