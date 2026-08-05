import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
  Get,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from '@/auth/auth.service';
import { LoginDto } from '@/auth/dto/login.dto';
import { RegisterDto } from '@/auth/dto/register.dto';
import { ChangeEmailDto } from '@/auth/dto/change-email.dto';
import { ChangePasswordDto } from '@/auth/dto/change-password.dto';
import { UpdateProfileDto } from '@/auth/dto/update-profile.dto';
import { ForgotPasswordDto } from '@/auth/dto/forgot-password.dto';
import { ResetPasswordDto } from '@/auth/dto/reset-password.dto';
import { ApiRegisterUser } from '@/auth/swagger/auth.post.register.swagger';
import { ApiLoginUser } from '@/auth/swagger/auth.post.login.swagger';
import { ApiRefreshTokens } from '@/auth/swagger/auth.post.refresh.swagger';
import { JwtRefreshAuthGuard } from '@/auth/jwt-refresh-auth.guard';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import type { Response } from 'express';

const AUTH_THROTTLE_LIMIT = Number(process.env.AUTH_THROTTLE_LIMIT ?? 5);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiRegisterUser()
  @Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
  async register(@Body() registerDto: RegisterDto) {
    return await this.authService.register(registerDto);
  }

  @Post('login')
  @ApiLoginUser()
  @Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);
    this.authService.setAuthCookies(
      res,
      result.access_token,
      result.refresh_token,
      result.user.role,
    );
    return { user: result.user };
  }

  @Post('refresh')
  @ApiRefreshTokens()
  @UseGuards(JwtRefreshAuthGuard)
  async refreshTokens(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = req.user.id;
    const tokens = await this.authService.refreshTokens(userId);
    this.authService.setAuthCookies(
      res,
      tokens.access_token,
      tokens.refresh_token,
      tokens.user.role,
    );
    return { user: tokens.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.['refresh_token'] as string | undefined;
    if (refreshToken) {
      await this.authService
        .revokeRefreshToken(refreshToken)
        .catch(() => undefined);
    }
    this.authService.clearAuthCookies(res);
    return { message: 'Logout realizado com sucesso.' };
  }

  // ── Password reset ─────────────────────────────────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // ── Settings endpoints ──────────────────────────────────────────────

  @Post('change-email')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async requestEmailChange(
    @Body() dto: ChangeEmailDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.authService.requestEmailChange(
      req.user.id,
      dto.newEmail,
      dto.password,
    );
  }

  @Get('confirm-email')
  @HttpCode(HttpStatus.OK)
  async confirmEmailChange(@Query('token') token: string) {
    return this.authService.confirmEmailChange(token);
  }

  @Post('confirm-email')
  @HttpCode(HttpStatus.OK)
  async confirmEmailChangePost(@Body('token') token: string) {
    return this.authService.confirmEmailChange(token);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.authService.changePassword(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post('update-profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.authService.updateProfile(req.user.id, dto.name);
  }
}
