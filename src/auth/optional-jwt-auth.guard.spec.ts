import { UnauthorizedException } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '@/auth/optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  let guard: OptionalJwtAuthGuard;

  beforeEach(() => {
    guard = new OptionalJwtAuthGuard();
  });

  it('retorna null quando há UnauthorizedException (token ausente/inválido)', () => {
    expect(guard.handleRequest(new UnauthorizedException(), null)).toBeNull();
  });

  it('propaga erros que não são de autenticação', () => {
    const err = new Error('db down');

    expect(() => guard.handleRequest(err, null)).toThrow('db down');
  });

  it('retorna o usuário quando a autenticação é bem-sucedida', () => {
    const user = { id: 'u1' };

    expect(guard.handleRequest(null, user)).toEqual(user);
  });

  it('retorna null quando não há erro nem usuário (token ausente sem exception)', () => {
    expect(guard.handleRequest(null, null)).toBeNull();
  });
});
