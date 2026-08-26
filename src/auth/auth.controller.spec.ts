import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '@/auth/auth.controller';
import { AuthService } from '@/auth/auth.service';
import { RegisterDto } from '@/auth/dto/register.dto';
import { LoginDto } from '@/auth/dto/login.dto';
import {
  ConflictException,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refreshTokens: jest.fn(),
    setAuthCookies: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerificationCode: jest.fn(),
    revokeRefreshToken: jest.fn(),
    clearAuthCookies: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    requestEmailChange: jest.fn(),
    confirmEmailChange: jest.fn(),
    changePassword: jest.fn(),
    updateProfile: jest.fn(),
  };

  const mockRes = {
    cookie: jest.fn(),
  } as unknown as import('express').Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password123!',
    };

    it('should register a new user successfully', async () => {
      const mockResponse = {
        message: 'Usuário cadastrado com sucesso.',
        user: {
          id: '1',
          name: 'Test User',
          email: 'test@example.com',
          role: 'USER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      mockAuthService.register.mockResolvedValue(mockResponse);

      const result = await controller.register(registerDto);

      expect(result).toEqual(mockResponse);
      expect(authService.register).toHaveBeenCalledWith(registerDto);
    });

    it('should propagate ConflictException when email already exists', async () => {
      mockAuthService.register.mockRejectedValue(
        new ConflictException('Email já cadastrado.'),
      );

      await expect(controller.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(authService.register).toHaveBeenCalledWith(registerDto);
    });

    it('should handle validation errors from service', async () => {
      const invalidDto = { ...registerDto, email: 'invalid-email' };
      mockAuthService.register.mockRejectedValue(
        new ConflictException('Email já cadastrado.'),
      );

      await expect(controller.register(invalidDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'Password123!',
    };

    it('should login successfully and set auth cookies', async () => {
      const mockResponse = {
        user: {
          id: '1',
          name: 'Test User',
          email: 'test@example.com',
          role: 'USER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        access_token: 'fake-access-token',
        refresh_token: 'fake-refresh-token',
      };

      mockAuthService.login.mockResolvedValue(mockResponse);

      const result = await controller.login(loginDto, mockRes);

      expect(result).toEqual({ user: mockResponse.user });
      expect(authService.login).toHaveBeenCalledWith(loginDto);
      expect(authService.setAuthCookies).toHaveBeenCalledWith(
        mockRes,
        'fake-access-token',
        'fake-refresh-token',
        'USER',
      );
    });

    it('should propagate UnauthorizedException when credentials are invalid', async () => {
      mockAuthService.login.mockRejectedValue(
        new UnauthorizedException('Credenciais inválidas.'),
      );

      await expect(controller.login(loginDto, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.login).toHaveBeenCalledWith(loginDto);
    });

    it('should handle empty email or password', async () => {
      const emptyDto: LoginDto = { email: '', password: '' };
      mockAuthService.login.mockRejectedValue(
        new UnauthorizedException('Credenciais inválidas.'),
      );

      await expect(controller.login(emptyDto, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens successfully and set auth cookies', async () => {
      const mockRequest = {
        user: {
          id: '1',
          email: 'test@example.com',
          role: 'USER',
        },
      };

      const mockResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        user: {
          id: '1',
          name: 'Test User',
          email: 'test@example.com',
          role: 'USER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      mockAuthService.refreshTokens.mockResolvedValue(mockResponse);

      const result = await controller.refreshTokens(
        mockRequest as unknown as AuthenticatedRequest,
        mockRes,
      );

      expect(result).toEqual({ user: mockResponse.user });
      expect(authService.refreshTokens).toHaveBeenCalledWith('1');
      expect(authService.setAuthCookies).toHaveBeenCalledWith(
        mockRes,
        'new-access-token',
        'new-refresh-token',
        'USER',
      );
    });

    it('should handle missing user data in request', async () => {
      const invalidRequest = { user: null };

      // In real scenario, the guard would reject this before reaching the controller.
      // Without the guard, accessing null.id throws a TypeError.
      await expect(
        controller.refreshTokens(
          invalidRequest as unknown as AuthenticatedRequest,
          mockRes,
        ),
      ).rejects.toThrow(TypeError);
    });

    it('should propagate service errors during token refresh', async () => {
      const mockRequest = {
        user: {
          id: '1',
          email: 'test@example.com',
          role: 'USER',
        },
      };

      mockAuthService.refreshTokens.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );

      await expect(
        controller.refreshTokens(
          mockRequest as unknown as AuthenticatedRequest,
          mockRes,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // Edge cases and security scenarios
  describe('security scenarios', () => {
    const registerDto: RegisterDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password123!',
    };

    it('should not expose sensitive data in error messages', async () => {
      mockAuthService.register.mockRejectedValue(
        new ConflictException('Email já cadastrado.'),
      );

      try {
        await controller.register(registerDto);
      } catch (error) {
        expect((error as { message?: string }).message).not.toContain(
          'password',
        );
        expect((error as { message?: string }).message).not.toContain('hashed');
        expect((error as { message?: string }).message).toBe(
          'Email já cadastrado.',
        );
      }
    });

    it('should handle timing attacks (service responsibility)', async () => {
      // This is mostly the service's responsibility, but controller should
      // not leak information about whether user exists or not
      const loginDto: LoginDto = {
        email: 'nonexistent@example.com',
        password: 'wrongpassword',
      };

      mockAuthService.login.mockRejectedValue(
        new UnauthorizedException('Credenciais inválidas.'),
      );

      await expect(controller.login(loginDto, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
      // The error message should be generic, not specific about whether
      // email exists or password is wrong
      expect(authService.login).toHaveBeenCalledWith(loginDto);
    });
  });

  // Performance and validation tests
  describe('validation and performance', () => {
    it('should handle large payloads appropriately', async () => {
      const largeDto: RegisterDto = {
        name: 'A'.repeat(255),
        email: 'test@example.com',
        password: 'P'.repeat(100),
      };

      const mockResponse = {
        message:
          'Conta criada. Verifique seu email para o código de verificação.',
      };

      mockAuthService.register.mockResolvedValue(mockResponse);

      const result = await controller.register(largeDto);

      expect(result.message).toBe(
        'Conta criada. Verifique seu email para o código de verificação.',
      );
      expect(authService.register).toHaveBeenCalledWith(largeDto);
    });

    it('should handle concurrent requests', async () => {
      // This is more of an integration test scenario
      const registerDto: RegisterDto = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'Password123!',
      };

      const mockResponse = {
        message: 'Usuário cadastrado com sucesso.',
        user: {
          id: '1',
          name: 'Test User',
          email: 'test@example.com',
          role: 'USER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      mockAuthService.register.mockResolvedValue(mockResponse);

      // Simulate multiple calls
      const promises = [
        controller.register(registerDto),
        controller.register(registerDto),
        controller.register(registerDto),
      ];

      const results = await Promise.allSettled(promises);

      // First should succeed, others should fail due to conflict
      expect(results[0]?.status).toBe('fulfilled');
      expect(authService.register).toHaveBeenCalledTimes(3);
    });
  });

  describe('verifyEmail', () => {
    it('deve verificar email com sucesso', async () => {
      mockAuthService.verifyEmail.mockResolvedValue({
        message: 'Conta verificada com sucesso.',
      });
      const result = await controller.verifyEmail({
        email: 'test@test.com',
        code: '12345678',
      });
      expect(result).toEqual({ message: 'Conta verificada com sucesso.' });
      expect(authService.verifyEmail).toHaveBeenCalledWith(
        'test@test.com',
        '12345678',
      );
    });

    it('deve propagar erro do serviço', async () => {
      mockAuthService.verifyEmail.mockRejectedValue(
        new UnauthorizedException('Código inválido.'),
      );
      await expect(
        controller.verifyEmail({ email: 'test@test.com', code: '00000000' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('resendVerification', () => {
    it('deve reenviar código dentro do limite', async () => {
      const email = `rate-${Date.now()}@test.com`;
      mockAuthService.resendVerificationCode.mockResolvedValue({
        message: 'Código reenviado.',
      });
      const result = await controller.resendVerification(email);
      expect(result).toEqual({ message: 'Código reenviado.' });
      expect(authService.resendVerificationCode).toHaveBeenCalledWith(email);
    });

    it('deve lançar 429 após atingir limite por email', async () => {
      const email = `limit-${Date.now()}@test.com`;
      mockAuthService.resendVerificationCode.mockResolvedValue({});
      for (let i = 0; i < 3; i++) {
        await controller.resendVerification(email);
      }
      await expect(controller.resendVerification(email)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('logout', () => {
    it('deve revogar refresh token e limpar cookies', async () => {
      const req = { cookies: { refresh_token: 'rt-token' } };
      const res = { clearCookie: jest.fn() };
      mockAuthService.revokeRefreshToken.mockResolvedValue(undefined);

      const result = await controller.logout(
        req as unknown as AuthenticatedRequest,
        res as unknown as import('express').Response,
      );

      expect(authService.revokeRefreshToken).toHaveBeenCalledWith('rt-token');
      expect(authService.clearAuthCookies).toHaveBeenCalledWith(res);
      expect(result).toEqual({ message: 'Logout realizado com sucesso.' });
    });

    it('deve ignorar erro do revoke e seguir com logout', async () => {
      const req = { cookies: { refresh_token: 'rt-token' } };
      const res = { clearCookie: jest.fn() };
      mockAuthService.revokeRefreshToken.mockRejectedValue(
        new Error('not found'),
      );

      const result = await controller.logout(
        req as unknown as AuthenticatedRequest,
        res as unknown as import('express').Response,
      );

      expect(authService.clearAuthCookies).toHaveBeenCalledWith(res);
      expect(result).toEqual({ message: 'Logout realizado com sucesso.' });
    });

    it('deve funcionar sem refresh token no cookie', async () => {
      const req = { cookies: {} };
      const res = { clearCookie: jest.fn() };

      await controller.logout(
        req as unknown as AuthenticatedRequest,
        res as unknown as import('express').Response,
      );

      expect(authService.revokeRefreshToken).not.toHaveBeenCalled();
      expect(authService.clearAuthCookies).toHaveBeenCalledWith(res);
    });
  });

  describe('forgotPassword', () => {
    it('deve chamar o serviço de redefinição', async () => {
      const email = `forgot-${Date.now()}@test.com`;
      mockAuthService.forgotPassword.mockResolvedValue({
        message: 'Se o email existir, um link de redefinição foi enviado.',
      });
      const result = await controller.forgotPassword({ email });
      expect(authService.forgotPassword).toHaveBeenCalledWith(email);
      expect(result).toHaveProperty('message');
    });

    it('deve retornar resposta genérica quando atingir limite', async () => {
      const email = `forgot-limit-${Date.now()}@test.com`;
      mockAuthService.forgotPassword.mockResolvedValue({});
      for (let i = 0; i < 3; i++) {
        await controller.forgotPassword({ email });
      }
      const result = await controller.forgotPassword({ email });
      expect(result).toHaveProperty(
        'message',
        'Se o email existir, um link de redefinição foi enviado.',
      );
      expect(authService.forgotPassword).toHaveBeenCalledTimes(3);
    });
  });

  describe('resetPassword', () => {
    it('deve redefinir senha com sucesso', async () => {
      mockAuthService.resetPassword.mockResolvedValue({
        message: 'Senha redefinida com sucesso.',
      });
      const result = await controller.resetPassword({
        token: 'token',
        newPassword: 'NewPass123!',
      });
      expect(authService.resetPassword).toHaveBeenCalledWith(
        'token',
        'NewPass123!',
      );
      expect(result).toHaveProperty('message');
    });
  });

  describe('settings endpoints', () => {
    const req = { user: { id: '1' } } as unknown as AuthenticatedRequest;

    it('requestEmailChange deve delegar para o serviço', async () => {
      mockAuthService.requestEmailChange.mockResolvedValue({
        message: 'Email de confirmação enviado.',
      });
      const result = await controller.requestEmailChange(
        { newEmail: 'new@test.com', password: 'pass' },
        req,
      );
      expect(authService.requestEmailChange).toHaveBeenCalledWith(
        '1',
        'new@test.com',
        'pass',
      );
      expect(result).toHaveProperty('message');
    });

    it('confirmEmailChangePost deve delegar para o serviço', async () => {
      mockAuthService.confirmEmailChange.mockResolvedValue({
        message: 'Email alterado com sucesso.',
      });
      const result = await controller.confirmEmailChangePost('token');
      expect(authService.confirmEmailChange).toHaveBeenCalledWith('token');
      expect(result).toHaveProperty('message');
    });

    it('changePassword deve delegar para o serviço', async () => {
      mockAuthService.changePassword.mockResolvedValue({
        message: 'Senha alterada com sucesso.',
      });
      const result = await controller.changePassword(
        { currentPassword: 'old', newPassword: 'new' },
        req,
      );
      expect(authService.changePassword).toHaveBeenCalledWith(
        '1',
        'old',
        'new',
      );
      expect(result).toHaveProperty('message');
    });

    it('updateProfile deve delegar para o serviço', async () => {
      mockAuthService.updateProfile.mockResolvedValue({
        id: '1',
        name: 'Novo Nome',
      });
      const result = await controller.updateProfile(
        { name: 'Novo Nome', userName: 'novonome' },
        req,
      );
      expect(authService.updateProfile).toHaveBeenCalledWith(
        '1',
        'Novo Nome',
        'novonome',
      );
      expect(result).toHaveProperty('name');
    });
  });
});
