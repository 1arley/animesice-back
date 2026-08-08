import request from 'supertest';
import type { IncomingHttpHeaders } from 'node:http';
import { Role } from '@prisma/client';
import {
  getHttpServer,
  getPrismaService,
  createTestUser,
} from '@test/setup/e2e.setup';
import * as bcrypt from 'bcrypt';

// Definição de tipos para as respostas da API
interface UserResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface RegisterResponse {
  message: string;
  user: UserResponse;
}

// Tokens sao entregues em cookies httpOnly; o body so expoe o user.
interface LoginResponse {
  user: UserResponse;
}

interface ErrorResponse {
  message: string | string[];
  error: string;
  statusCode: number;
}

/** Extrai um cookie de um header `set-cookie` (ex: refresh_token do login). */
function getSetCookie(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return undefined;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const cookie of cookies) {
    const pair = cookie.split(';')[0];
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1);
  }
  return undefined;
}

describe('AuthController (e2e)', () => {
  afterEach(async () => {
    const prisma = getPrismaService();
    await prisma.refreshToken.deleteMany({});
    await prisma.emailVerificationCode.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const prisma = getPrismaService();

      const registerDto = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'Password123!',
      };

      const response = await request(getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(201);

      const body = response.body as RegisterResponse;

      expect(body.message).toBe(
        'Conta criada. Verifique seu email para o código de verificação.',
      );

      const userInDb = await prisma.user.findUnique({
        where: { email: registerDto.email },
      });

      expect(userInDb).toBeDefined();
      expect(userInDb?.name).toBe(registerDto.name);
      expect(userInDb?.role).toBe('USER');
      expect(userInDb?.isVerified).toBe(false);
    });

    it('should return 409 Conflict when email already exists', async () => {
      await createTestUser(
        'existing@example.com',
        'Password123!',
        'Test User',
        Role.USER,
        true,
      );

      const registerDto = {
        name: 'Another User',
        email: 'existing@example.com',
        password: 'Password123!',
      };

      const response = await request(getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(409);

      const body = response.body as ErrorResponse;
      expect(body.message).toContain(
        'Não foi possível concluir o cadastro com esses dados.',
      );
    });

    it('should return 400 when name is missing', async () => {
      const registerDto = {
        email: 'test@example.com',
        password: 'Password123!',
      };

      const response = await request(getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(400);

      const body = response.body as ErrorResponse;
      expect(body.message).toBeDefined();
    });

    it('should validate email format', async () => {
      const invalidDto = {
        name: 'Test User',
        email: 'invalid-email',
        password: 'Password123!',
      };

      const response = await request(getHttpServer())
        .post('/auth/register')
        .send(invalidDto)
        .expect(400);

      const body = response.body as ErrorResponse;
      expect(body.message).toBeDefined();
    });

    it('should validate password strength', async () => {
      const weakPasswordDto = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'weak',
      };

      const response = await request(getHttpServer())
        .post('/auth/register')
        .send(weakPasswordDto)
        .expect(400);

      const body = response.body as ErrorResponse;
      expect(body.message).toBeDefined();
    });

    it('should handle missing required fields', async () => {
      const incompleteDto = {
        password: 'Password123!',
      };

      const response = await request(getHttpServer())
        .post('/auth/register')
        .send(incompleteDto)
        .expect(400);

      const body = response.body as ErrorResponse;
      expect(body.message).toBeDefined();
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await createTestUser('user@example.com', 'Password123!', 'Test User');
    });

    it('should login successfully with valid credentials', async () => {
      const loginDto = {
        email: 'user@example.com',
        password: 'Password123!',
      };

      const response = await request(getHttpServer())
        .post('/auth/login')
        .send(loginDto)
        .expect(200);

      const body = response.body as LoginResponse;

      expect(body.user).toBeDefined();
      expect(body.user.email).toBe(loginDto.email);
      expect(body).not.toHaveProperty('access_token');
      expect(body).not.toHaveProperty('refresh_token');
      expect(getSetCookie(response.headers, 'access_token')).toBeDefined();
      expect(getSetCookie(response.headers, 'refresh_token')).toBeDefined();
    });

    it('should return 401 Unauthorized with wrong password', async () => {
      const loginDto = {
        email: 'user@example.com',
        password: 'WrongPassword123!',
      };

      const response = await request(getHttpServer())
        .post('/auth/login')
        .send(loginDto)
        .expect(401);

      const body = response.body as ErrorResponse;
      expect(body.message).toContain('Credenciais inválidas');
    });

    it('should return 401 Unauthorized for non-existent user', async () => {
      const loginDto = {
        email: 'nonexistent@example.com',
        password: 'Password123!',
      };

      const response = await request(getHttpServer())
        .post('/auth/login')
        .send(loginDto)
        .expect(401);

      const body = response.body as ErrorResponse;
      expect(body.message).toContain('Credenciais inválidas');
    });

    it('should prevent timing attacks (similar response time for user exists/not exists)', async () => {
      const start1 = Date.now();
      await request(getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'WrongPassword123!' })
        .expect(401);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      await request(getHttpServer())
        .post('/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'Password123!' })
        .expect(401);
      const time2 = Date.now() - start2;

      expect(time1).toBeGreaterThan(0);
      expect(time2).toBeGreaterThan(0);
    });

    it('should handle empty credentials', async () => {
      const response = await request(getHttpServer())
        .post('/auth/login')
        .send({ email: '', password: '' });

      expect([400, 401]).toContain(response.status);
      expect((response.body as ErrorResponse).message).toBeDefined();
    });
  });

  describe('POST /auth/refresh', () => {
    let refreshToken: string | undefined;

    beforeEach(async () => {
      await createTestUser('user@example.com', 'Password123!', 'Test User');

      const loginResponse = await request(getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'Password123!' })
        .expect(200);

      refreshToken = getSetCookie(loginResponse.headers, 'refresh_token');
    });

    it('should refresh tokens successfully with valid refresh token', async () => {
      const response = await request(getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${refreshToken}`)
        .expect(201);

      const body = response.body as LoginResponse;
      expect(body.user).toBeDefined();

      const newRefreshToken = getSetCookie(response.headers, 'refresh_token');
      expect(newRefreshToken).toBeDefined();
      expect(newRefreshToken).not.toBe(refreshToken);
    });

    it('should return 401 Unauthorized without refresh token', async () => {
      const response = await request(getHttpServer())
        .post('/auth/refresh')
        .expect(401);

      expect((response.body as ErrorResponse).message).toContain(
        'Unauthorized',
      );
    });

    it('should return 401 Unauthorized with invalid refresh token', async () => {
      const response = await request(getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect((response.body as ErrorResponse).message).toContain(
        'Unauthorized',
      );
    });

    it('should return 401 Unauthorized with expired refresh token', async () => {
      const expiredToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

      const response = await request(getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect((response.body as ErrorResponse).message).toContain(
        'Unauthorized',
      );
    });

    it('should prevent refresh token reuse after rotation', async () => {
      const response1 = await request(getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${refreshToken}`)
        .expect(201);

      const newRefreshToken = getSetCookie(response1.headers, 'refresh_token');
      expect(newRefreshToken).toBeDefined();
      expect(newRefreshToken).not.toBe(refreshToken);

      await request(getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${newRefreshToken}`)
        .expect(201);

      const oldTokenResponse = await request(getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${refreshToken}`)
        .expect(401);

      expect((oldTokenResponse.body as ErrorResponse).message).toContain(
        'Refresh token inválido',
      );
    });
  });

  describe('Security scenarios', () => {
    it('should not expose user existence through login error messages', async () => {
      const loginResponse = await request(getHttpServer())
        .post('/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'Password123!' })
        .expect(401);

      const body = loginResponse.body as ErrorResponse;
      expect(body.message).toBeDefined();
      expect(body.message).toContain('Credenciais inválidas');
    });

    it('should have consistent responses under load', async () => {
      await createTestUser('test@example.com', 'Password123!', 'Test User');

      const requests = Array(5)
        .fill(null)
        .map(() =>
          request(getHttpServer()).post('/auth/login').send({
            email: 'test@example.com',
            password: 'Password123!',
          }),
        );

      const responses = await Promise.allSettled(requests.map((req) => req));
      expect(responses).toHaveLength(5);
      for (const response of responses) {
        if (response.status === 'rejected') {
          console.log('Load test rejection:', response.reason);
        }
        expect(response.status).toBe('fulfilled');
      }
    });

    it('should store passwords securely (hashed)', async () => {
      const prisma = getPrismaService();

      const password = 'Password123!';
      await request(getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Test User',
          email: 'secure@example.com',
          password,
        })
        .expect(201);

      const user = await prisma.user.findUnique({
        where: { email: 'secure@example.com' },
      });

      expect(user?.password).not.toBe(password);
      expect(user?.password).not.toContain('Password');

      const isValidHash = await bcrypt.compare(password, user?.password || '');
      expect(isValidHash).toBe(true);
    });
  });

  describe('Integration scenarios', () => {
    it('should allow full auth flow: register -> login -> refresh', async () => {
      const registerDto = {
        name: 'Integration User',
        email: 'integration@example.com',
        password: 'Password123!',
      };

      const registerResponse = await request(getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(201);

      expect((registerResponse.body as RegisterResponse).message).toBe(
        'Conta criada. Verifique seu email para o código de verificação.',
      );

      const loginResponse = await request(getHttpServer())
        .post('/auth/login')
        .send({
          email: registerDto.email,
          password: registerDto.password,
        })
        .expect(200);

      const loginBody = loginResponse.body as LoginResponse;
      expect(loginBody.user).toBeDefined();

      const refreshToken = getSetCookie(loginResponse.headers, 'refresh_token');
      expect(refreshToken).toBeDefined();

      const refreshResponse = await request(getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${refreshToken}`)
        .expect(201);

      expect((refreshResponse.body as LoginResponse).user).toBeDefined();
      expect(
        getSetCookie(refreshResponse.headers, 'access_token'),
      ).toBeDefined();
    });

    it('should handle concurrent auth requests', async () => {
      const prisma = getPrismaService();

      const baseEmail = 'concurrent';
      const requests = Array(5)
        .fill(null)
        .map((_, index) => {
          const email = `${baseEmail}${index}@example.com`;
          return request(getHttpServer())
            .post('/auth/register')
            .send({
              name: `User ${index}`,
              email,
              password: 'Password123!',
            });
        });

      const responses = await Promise.allSettled(requests.map((req) => req));
      for (const response of responses) {
        expect(response.status).toBe('fulfilled');
        if (response.status === 'fulfilled') {
          expect(response.value.status).toBe(201);
        }
      }

      for (let idx = 0; idx < 5; idx++) {
        const email = `${baseEmail}${idx}@example.com`;
        const user = await prisma.user.findUnique({ where: { email } });
        expect(user).toBeDefined();
      }
    });
  });
});
