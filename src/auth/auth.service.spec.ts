import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '@/auth/auth.service';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { MailService } from '@/mail/mail.service';
import { TurnstileService } from '@/auth/turnstile/turnstile.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    emailVerificationCode: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    emailChangeToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const mockMailService = {
    sendVerificationCode: jest.fn().mockResolvedValue(true),
    sendEmailChangeConfirm: jest.fn().mockResolvedValue(true),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  };

  const mockTurnstileService = {
    verify: jest.fn().mockResolvedValue(true),
  };

  const CONFIG_MAP: Record<string, string> = {
    JWT_ACCESS_EXPIRES_IN: '7d',
    JWT_REFRESH_EXPIRES_IN: '30d',
    JWT_COOKIE_SAMESITE: 'lax',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    FRONTEND_URL: 'http://localhost:3000',
  };

  const mockConfigService = {
    get: jest.fn((key: string) => CONFIG_MAP[key]),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockMailService.sendVerificationCode.mockResolvedValue(true);
    mockMailService.sendEmailChangeConfirm.mockResolvedValue(true);
    mockMailService.sendPasswordResetEmail.mockResolvedValue(true);
    mockTurnstileService.verify.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MailService, useValue: mockMailService },
        { provide: TurnstileService, useValue: mockTurnstileService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
    // Garante um mock fresco por teste (evita implementação residual).
    configService.get = jest.fn((key: string) => CONFIG_MAP[key]);
  });

  describe('register', () => {
    const registerDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password123!',
    };

    it('deve registrar um novo usuário com sucesso', async () => {
      const hashedPassword = await bcrypt.hash(registerDto.password, 10);
      const createdAt = new Date('2025-01-01T00:00:00Z');
      const updatedAt = new Date('2025-01-01T00:00:00Z');
      const createdUser = {
        id: '1',
        name: registerDto.name,
        email: registerDto.email,
        password: hashedPassword,
        isVerified: false,
        createdAt,
        updatedAt,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(createdUser);

      const result = await service.register(registerDto);

      expect(result).toHaveProperty(
        'message',
        'Conta criada. Verifique seu email para o código de verificação.',
      );
      expect(mockMailService.sendVerificationCode).toHaveBeenCalledWith(
        registerDto.email,
        expect.any(String),
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: registerDto.email },
      });
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('não vaza existência de email registrado (verificado) — resposta genérica', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: registerDto.email,
        isVerified: true,
      });

      const result = await service.register(registerDto);

      expect(result).toHaveProperty(
        'message',
        'Conta criada. Verifique seu email para o código de verificação.',
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mockMailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('re-registro de email não verificado atualiza credenciais e reenvia código', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: registerDto.email,
        isVerified: false,
      });
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.emailVerificationCode.deleteMany.mockResolvedValue({});
      mockPrismaService.emailVerificationCode.create.mockResolvedValue({});

      const result = await service.register(registerDto);

      expect(result).toHaveProperty(
        'message',
        'Conta criada. Verifique seu email para o código de verificação.',
      );
      expect(prisma.user.update).toHaveBeenCalled();
      expect(mockMailService.sendVerificationCode).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'Password123!',
    };

    it('deve fazer login com credenciais válidas e retornar tokens', async () => {
      const hashedPassword = await bcrypt.hash(loginDto.password, 10);
      const user = {
        id: '1',
        name: 'Test User',
        email: loginDto.email,
        password: hashedPassword,
        role: 'USER',
        isVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(jwtService, 'signAsync').mockResolvedValue('fake-jwt-token');
      jest.spyOn(configService, 'get').mockReturnValue('fake-secret');
      mockPrismaService.user.findUnique.mockResolvedValue(user);

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('user');
      expect(result.user).not.toHaveProperty('password');
      expect(result).toHaveProperty('access_token', 'fake-jwt-token');
      expect(result).toHaveProperty('refresh_token', 'fake-jwt-token');
    });

    it('deve lançar UnauthorizedException se usuário não existe', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('deve lançar UnauthorizedException se senha estiver incorreta', async () => {
      const user = {
        id: '1',
        email: loginDto.email,
        password: await bcrypt.hash('DifferentPassword', 10),
        role: 'USER',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(user);
      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refreshTokens', () => {
    it('deve gerar novos tokens para um userId válido', async () => {
      const user = {
        id: '1',
        email: 'test@example.com',
        role: 'USER',
      };

      jest.spyOn(jwtService, 'signAsync').mockResolvedValue('fake-jwt-token');
      jest.spyOn(configService, 'get').mockReturnValue('fake-secret');
      mockPrismaService.user.findUnique.mockResolvedValue(user);

      const result = await service.refreshTokens('1');

      expect(result).toHaveProperty('access_token', 'fake-jwt-token');
      expect(result).toHaveProperty('refresh_token', 'fake-jwt-token');
    });

    it('deve lançar UnauthorizedException se userId não existir', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.refreshTokens('999')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('register (captcha, userName, unique violation)', () => {
    const registerDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password123!',
    };

    afterEach(() => {
      delete process.env.TURNSTILE_ENABLED;
    });

    it('deve verificar captcha quando TURNSTILE_ENABLED=true', async () => {
      process.env.TURNSTILE_ENABLED = 'true';
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({ id: '1' });
      mockPrismaService.emailVerificationCode.create.mockResolvedValue({});

      const result = await service.register(registerDto);

      expect(mockTurnstileService.verify).toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });

    it('deve registrar com userName normalizado', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockImplementation(
        async (args: { data: { userName?: string } }) =>
          args.data.userName
            ? { id: '2', userName: args.data.userName }
            : { id: '2' },
      );
      mockPrismaService.emailVerificationCode.create.mockResolvedValue({});

      const result = await service.register({
        ...registerDto,
        userName: '  MeuNome  ',
      });

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { userName: 'meunome' },
      });
      expect(mockPrismaService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userName: 'meunome' }),
        }),
      );
      expect(result).toHaveProperty('message');
    });

    it('deve lançar ConflictException se userName violar unicidade', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockRejectedValue({ code: 'P2002' });
      mockPrismaService.emailVerificationCode.create.mockResolvedValue({});

      await expect(
        service.register({ ...registerDto, userName: 'existente' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login (unverified, captcha)', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'Password123!',
    };

    afterEach(() => {
      delete process.env.TURNSTILE_ENABLED;
    });

    it('deve lançar UnauthorizedException se usuário não está verificado', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: loginDto.email,
        password: await bcrypt.hash(loginDto.password, 10),
        isVerified: false,
      });

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('deve verificar captcha no login quando TURNSTILE_ENABLED=true', async () => {
      process.env.TURNSTILE_ENABLED = 'true';
      const user = {
        id: '1',
        email: loginDto.email,
        password: await bcrypt.hash(loginDto.password, 10),
        isVerified: true,
        role: 'USER',
      };
      mockPrismaService.user.findUnique.mockResolvedValue(user);
      jest.spyOn(jwtService, 'signAsync').mockResolvedValue('fake-jwt-token');
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.login(loginDto);

      expect(mockTurnstileService.verify).toHaveBeenCalled();
      expect(result).toHaveProperty('access_token');
    });
  });

  describe('requestEmailChange', () => {
    it('deve lançar UnauthorizedException se usuário não existir', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(
        service.requestEmailChange('999', 'new@test.com', 'pass'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('deve lançar BadRequestException se senha atual estiver incorreta', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        password: await bcrypt.hash('correct', 10),
      });
      await expect(
        service.requestEmailChange('1', 'new@test.com', 'wrong'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException se novo email for igual ao atual', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'same@test.com',
        password: await bcrypt.hash('pass', 10),
      });
      await expect(
        service.requestEmailChange('1', 'same@test.com', 'pass'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar ConflictException se novo email já estiver em uso', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          id: '1',
          email: 'current@test.com',
          password: await bcrypt.hash('pass', 10),
        })
        .mockResolvedValueOnce({ id: '2', email: 'taken@test.com' });

      await expect(
        service.requestEmailChange('1', 'taken@test.com', 'pass'),
      ).rejects.toThrow(ConflictException);
    });

    it('deve enviar email de confirmação com sucesso', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          id: '1',
          email: 'current@test.com',
          password: await bcrypt.hash('pass', 10),
        })
        .mockResolvedValueOnce(null);
      mockPrismaService.emailChangeToken.create.mockResolvedValue({});

      const result = await service.requestEmailChange(
        '1',
        'new@test.com',
        'pass',
      );

      expect(mockPrismaService.emailChangeToken.deleteMany).toHaveBeenCalled();
      expect(mockPrismaService.emailChangeToken.create).toHaveBeenCalled();
      expect(mockMailService.sendEmailChangeConfirm).toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });
  });

  describe('confirmEmailChange', () => {
    const token = 'valid-token';

    it('deve lançar BadRequestException se token for inválido', async () => {
      mockPrismaService.emailChangeToken.findUnique.mockResolvedValue(null);
      await expect(service.confirmEmailChange(token)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar BadRequestException se token expirou', async () => {
      mockPrismaService.emailChangeToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: '1',
        newEmail: 'new@test.com',
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.confirmEmailChange(token)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.emailChangeToken.delete).toHaveBeenCalled();
    });

    it('deve alterar email com sucesso', async () => {
      mockPrismaService.emailChangeToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: '1',
        newEmail: 'new@test.com',
        expiresAt: new Date(Date.now() + 3600000),
      });
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.emailChangeToken.delete.mockResolvedValue({});

      const result = await service.confirmEmailChange(token);

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });
  });

  describe('changePassword', () => {
    it('deve lançar UnauthorizedException se usuário não existir', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.changePassword('999', 'old', 'new')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('deve lançar BadRequestException se senha atual estiver incorreta', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        password: await bcrypt.hash('correct', 10),
      });
      await expect(service.changePassword('1', 'wrong', 'new')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar BadRequestException se nova senha for igual à atual', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        password: await bcrypt.hash('same', 10),
      });
      await expect(service.changePassword('1', 'same', 'same')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve alterar senha com sucesso', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        password: await bcrypt.hash('old-pass', 10),
      });
      mockPrismaService.user.update.mockResolvedValue({});

      const result = await service.changePassword('1', 'old-pass', 'new-pass');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ password: expect.any(String) }),
        }),
      );
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });
  });

  describe('updateProfile', () => {
    it('deve lançar BadRequestException se nada for passado', async () => {
      await expect(service.updateProfile('1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve atualizar apenas o nome', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        id: '1',
        name: 'Novo Nome',
        password: 'hashed',
      });

      const result = await service.updateProfile('1', 'Novo Nome');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Novo Nome' },
        }),
      );
      expect(result).not.toHaveProperty('password');
    });
  });

  describe('forgotPassword', () => {
    it('deve retornar mensagem genérica se email não existir', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword('nonexistent@test.com');
      expect(result).toHaveProperty('message');
    });

    it('deve enviar email de redefinição com sucesso', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'user@test.com',
      });
      mockPrismaService.passwordResetToken.create.mockResolvedValue({});

      const result = await service.forgotPassword('user@test.com');

      expect(
        mockPrismaService.passwordResetToken.deleteMany,
      ).toHaveBeenCalled();
      expect(mockPrismaService.passwordResetToken.create).toHaveBeenCalled();
      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });
  });

  describe('resetPassword', () => {
    const token = 'reset-token';

    it('deve lançar BadRequestException se token for inválido', async () => {
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword(token, 'new-pass')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar BadRequestException se token expirou', async () => {
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: 'pt1',
        userId: '1',
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.resetPassword(token, 'new-pass')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.passwordResetToken.delete).toHaveBeenCalled();
    });

    it('deve redefinir senha com sucesso', async () => {
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: 'pt1',
        userId: '1',
        expiresAt: new Date(Date.now() + 3600000),
      });
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.passwordResetToken.delete.mockResolvedValue({});

      const result = await service.resetPassword(token, 'new-pass');

      expect(mockPrismaService.user.update).toHaveBeenCalled();
      expect(mockPrismaService.passwordResetToken.delete).toHaveBeenCalled();
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });
  });

  describe('verifyEmail', () => {
    const code = '12345678';
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    it('deve lançar NotFoundException se usuário não existir', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.verifyEmail('test@test.com', code)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve retornar mensagem se conta já verificada', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        isVerified: true,
      });
      const result = await service.verifyEmail('test@test.com', code);
      expect(result).toHaveProperty('message', 'Conta já verificada.');
    });

    it('deve lançar BadRequestException se nenhum código encontrado', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        isVerified: false,
      });
      mockPrismaService.emailVerificationCode.findFirst.mockResolvedValue(null);
      await expect(service.verifyEmail('test@test.com', code)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar BadRequestException se muitas tentativas', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        isVerified: false,
      });
      mockPrismaService.emailVerificationCode.findFirst.mockResolvedValue({
        id: 'c1',
        attempts: 5,
      });
      await expect(service.verifyEmail('test@test.com', code)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.emailVerificationCode.delete).toHaveBeenCalled();
    });

    it('deve verificar email com sucesso', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        isVerified: false,
      });
      mockPrismaService.emailVerificationCode.findFirst.mockResolvedValue({
        id: 'c1',
        userId: '1',
        attempts: 0,
        codeHash,
        expiresAt: new Date(Date.now() + 3600000),
      });
      mockPrismaService.emailVerificationCode.update.mockResolvedValue({});
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.emailVerificationCode.delete.mockResolvedValue({});

      const result = await service.verifyEmail('test@test.com', code);

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(result).toHaveProperty('message', 'Conta verificada com sucesso.');
    });
  });

  describe('resendVerificationCode', () => {
    it('deve retornar mensagem genérica se email não existir', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      const result = await service.resendVerificationCode('test@test.com');
      expect(result).toHaveProperty('message');
    });

    it('deve retornar mensagem se conta já verificada', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        isVerified: true,
      });
      const result = await service.resendVerificationCode('test@test.com');
      expect(result).toHaveProperty('message', 'Conta já verificada.');
    });

    it('deve reenviar código de verificação com sucesso', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        isVerified: false,
      });
      mockPrismaService.emailVerificationCode.create.mockResolvedValue({});

      const result = await service.resendVerificationCode('test@test.com');

      expect(
        mockPrismaService.emailVerificationCode.deleteMany,
      ).toHaveBeenCalled();
      expect(mockPrismaService.emailVerificationCode.create).toHaveBeenCalled();
      expect(mockMailService.sendVerificationCode).toHaveBeenCalled();
      expect(result).toHaveProperty('message');
    });
  });

  describe('setAuthCookies / clearAuthCookies', () => {
    const res = { cookie: jest.fn(), clearCookie: jest.fn() };

    it('deve definir cookies de autenticação', () => {
      service.setAuthCookies(res as any, 'at', 'rt', 'USER');
      expect(res.cookie).toHaveBeenCalledTimes(3);
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'at',
        expect.any(Object),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'rt',
        expect.any(Object),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'role',
        'USER',
        expect.any(Object),
      );
    });

    it('deve limpar cookies de autenticação', () => {
      service.clearAuthCookies(res as any);
      expect(res.clearCookie).toHaveBeenCalledTimes(3);
      expect(res.clearCookie).toHaveBeenCalledWith(
        'access_token',
        expect.any(Object),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.any(Object),
      );
      expect(res.clearCookie).toHaveBeenCalledWith('role', expect.any(Object));
    });
  });

  describe('revokeRefreshToken', () => {
    const token = 'some-token';

    it('deve lançar NotFoundException se token não for encontrado', async () => {
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.revokeRefreshToken(token)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve revogar refresh token com sucesso', async () => {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.revokeRefreshToken(token)).resolves.not.toThrow();
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: tokenHash },
      });
    });
  });
});
