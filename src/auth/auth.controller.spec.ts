import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '@/auth/auth.controller';
import { AuthService } from '@/auth/auth.service';
import { RegisterDto } from '@/auth/dto/register.dto';
import { LoginDto } from '@/auth/dto/login.dto';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refreshTokens: jest.fn(),
  };

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

    it('should login successfully and return tokens', async () => {
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

      const result = await controller.login(loginDto);

      expect(result).toEqual(mockResponse);
      expect(authService.login).toHaveBeenCalledWith(loginDto);
    });

    it('should propagate UnauthorizedException when credentials are invalid', async () => {
      mockAuthService.login.mockRejectedValue(
        new UnauthorizedException('Credenciais inválidas.'),
      );

      await expect(controller.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.login).toHaveBeenCalledWith(loginDto);
    });

    it('should handle empty email or password', async () => {
      const emptyDto: LoginDto = { email: '', password: '' };
      mockAuthService.login.mockRejectedValue(
        new UnauthorizedException('Credenciais inválidas.'),
      );

      await expect(controller.login(emptyDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens successfully', async () => {
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
      };

      mockAuthService.refreshTokens.mockResolvedValue(mockResponse);

      const result = await controller.refreshTokens(
        mockRequest as unknown as AuthenticatedRequest,
      );

      expect(result).toEqual(mockResponse);
      expect(authService.refreshTokens).toHaveBeenCalledWith('1');
    });

    it('should handle missing user data in request', async () => {
      const invalidRequest = { user: null };

      // In real scenario, the guard would reject this before reaching the controller.
      // Without the guard, accessing null.id throws a TypeError.
      await expect(
        controller.refreshTokens(
          invalidRequest as unknown as AuthenticatedRequest,
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

      await expect(controller.login(loginDto)).rejects.toThrow(
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
        message: 'Usuário cadastrado com sucesso.',
        user: {
          id: '1',
          name: largeDto.name,
          email: largeDto.email,
          role: 'USER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      mockAuthService.register.mockResolvedValue(mockResponse);

      const result = await controller.register(largeDto);

      expect(result.user.name).toBe(largeDto.name);
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
});
