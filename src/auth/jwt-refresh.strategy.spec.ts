import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { JwtRefreshStrategy } from '@/auth/jwt-refresh.strategy';

describe('JwtRefreshStrategy', () => {
  let strategy: JwtRefreshStrategy;
  const prisma = {
    user: { findUnique: jest.fn() },
    refreshToken: { findMany: jest.fn() },
  };
  const config = { getOrThrow: jest.fn().mockReturnValue('refresh-secret') };

  const user = { id: 'u1', email: 'a@b.com', role: 'USER' };

  function hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtRefreshStrategy(config as any, prisma as any);
  });

  function buildReq(cookies: Record<string, string> = {}): any {
    return {
      cookies,
      get: jest.fn((h: string) =>
        h === 'Authorization' ? 'Bearer token-do-header' : undefined,
      ),
    };
  }

  it('lê o segredo JWT_REFRESH_SECRET do ConfigService', () => {
    expect(config.getOrThrow).toHaveBeenCalledWith('JWT_REFRESH_SECRET');
  });

  it('valida refresh token vindo do cookie', async () => {
    const token = 'cookie-token';
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.refreshToken.findMany.mockResolvedValue([{ token: hash(token) }]);

    const result = await strategy.validate(buildReq({ refresh_token: token }), {
      sub: 'u1',
    } as any);

    expect(result).toEqual({
      id: 'u1',
      email: 'a@b.com',
      role: 'USER',
      refreshToken: token,
    });
  });

  it('valida refresh token vindo do header Authorization', async () => {
    const token = 'token-do-header';
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.refreshToken.findMany.mockResolvedValue([{ token: hash(token) }]);

    const result = await strategy.validate(buildReq(), { sub: 'u1' } as any);

    expect(result.refreshToken).toBe(token);
  });

  it('lança UnauthorizedException quando o token está ausente', async () => {
    const req = {
      cookies: {},
      get: jest.fn(() => undefined),
    } as any;

    await expect(
      strategy.validate(req, { sub: 'u1' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lança UnauthorizedException quando o usuário não existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate(buildReq({ refresh_token: 't' }), { sub: 'u1' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lança UnauthorizedException quando não há refresh tokens válidos', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.refreshToken.findMany.mockResolvedValue([]);

    await expect(
      strategy.validate(buildReq({ refresh_token: 't' }), { sub: 'u1' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lança UnauthorizedException quando o hash não corresponde', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.refreshToken.findMany.mockResolvedValue([
      { token: hash('outro-token') },
    ]);

    await expect(
      strategy.validate(buildReq({ refresh_token: 'meu-token' }), {
        sub: 'u1',
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('retorna somente os campos necessários do refresh token', async () => {
    const token = 'valid-token';
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.refreshToken.findMany.mockResolvedValue([
      { token: hash(token), id: 'rt-1' },
    ]);

    const result = await strategy.validate(buildReq({ refresh_token: token }), {
      sub: 'u1',
    } as any);

    expect(Object.keys(result)).toEqual([
      'id',
      'email',
      'role',
      'refreshToken',
    ]);
  });
});
