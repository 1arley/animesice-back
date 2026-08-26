import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '@/auth/jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const prisma = { user: { findUnique: jest.fn() } };
  const config = { getOrThrow: jest.fn().mockReturnValue('access-secret') };

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(config as any, prisma as any);
  });

  it('lê o segredo do ConfigService', () => {
    expect(config.getOrThrow).toHaveBeenCalledWith('JWT_ACCESS_SECRET');
  });

  it('retorna o usuário sem a senha', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.com',
      role: 'USER',
      password: 'hash',
      name: 'Ana',
    };
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await strategy.validate({
      sub: 'u1',
      email: 'a@b.com',
      role: 'USER',
    } as any);

    expect(result).toEqual({
      id: 'u1',
      email: 'a@b.com',
      role: 'USER',
      name: 'Ana',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
    });
  });

  it('lança UnauthorizedException quando o usuário não existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'inexistente' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('preserva todos os campos do usuário', async () => {
    const user = {
      id: 'u2',
      email: 'b@b.com',
      role: 'ADMIN',
      password: 'x',
      isVerified: true,
      createdAt: new Date(),
    };
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await strategy.validate({ sub: 'u2' } as any);

    expect(result).toEqual({
      id: 'u2',
      email: 'b@b.com',
      role: 'ADMIN',
      isVerified: true,
      createdAt: user.createdAt,
    });
  });
});
