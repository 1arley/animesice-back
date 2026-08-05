import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { LoginDto } from '@/auth/dto/login.dto';
import { RegisterDto } from '@/auth/dto/register.dto';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { Response } from 'express';
import { BCRYPT_ROUNDS } from '@/common/constants';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ── Cookie helpers ──────────────────────────────────────────────────

  private getCookieOptions() {
    const expiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '7d';
    let maxAge = 7 * 24 * 60 * 60 * 1000;
    if (expiresIn.endsWith('d')) {
      maxAge = parseInt(expiresIn.slice(0, -1)) * 24 * 60 * 60 * 1000;
    } else if (expiresIn.endsWith('h')) {
      maxAge = parseInt(expiresIn.slice(0, -1)) * 60 * 60 * 1000;
    } else if (expiresIn.endsWith('m')) {
      maxAge = parseInt(expiresIn.slice(0, -1)) * 60 * 1000;
    }

    const explicit = this.configService.get<string>('JWT_COOKIE_SECURE');
    const secure =
      explicit === 'true' ||
      (process.env.NODE_ENV === 'production' && explicit !== 'false');

    return {
      httpOnly: true,
      secure,
      sameSite: (this.configService.get<string>('JWT_COOKIE_SAMESITE') ||
        'lax') as 'lax' | 'strict' | 'none',
      domain: this.configService.get<string>('JWT_COOKIE_DOMAIN') || undefined,
      path: '/',
      maxAge,
    };
  }

  private getRefreshCookieOptions() {
    const opts = this.getCookieOptions();
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d';
    let maxAge = 30 * 24 * 60 * 60 * 1000;
    if (refreshExpiresIn.endsWith('d')) {
      maxAge = parseInt(refreshExpiresIn.slice(0, -1)) * 24 * 60 * 60 * 1000;
    } else if (refreshExpiresIn.endsWith('h')) {
      maxAge = parseInt(refreshExpiresIn.slice(0, -1)) * 60 * 60 * 1000;
    }
    return { ...opts, maxAge };
  }

  setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    res.cookie('access_token', accessToken, this.getCookieOptions());
    res.cookie('refresh_token', refreshToken, this.getRefreshCookieOptions());
  }

  clearAuthCookies(res: Response) {
    const opts = this.getCookieOptions();
    res.clearCookie('access_token', opts);
    res.clearCookie('refresh_token', this.getRefreshCookieOptions());
  }

  // ── Auth flows ──────────────────────────────────────────────────────

  async register(registerDto: RegisterDto) {
    const { name, email, password } = registerDto;

    const userExists = await this.prisma.user.findUnique({
      where: { email },
    });

    if (userExists) {
      throw new ConflictException(
        'Não foi possível concluir o cadastro com esses dados.',
      );
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: 'USER',
      },
    });

    const { password: _, ...userWithoutPassword } = user;

    return {
      message: 'Usuário cadastrado com sucesso.',
      user: userWithoutPassword,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const tokens = await this.getTokens(user.id, user.email, user.role);

    await this.revokeAllUserRefreshTokens(user.id);
    await this.createRefreshToken(user.id, tokens.refresh_token);

    const { password: _, ...userWithoutPassword } = user;

    return {
      ...tokens,
      user: userWithoutPassword,
    };
  }

  async refreshTokens(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const tokens = await this.getTokens(userId, user.email, user.role);

    await this.revokeAllUserRefreshTokens(userId);
    await this.createRefreshToken(userId, tokens.refresh_token);

    return tokens;
  }

  // ── Settings: change email ──────────────────────────────────────────

  async requestEmailChange(
    userId: string,
    newEmail: string,
    currentPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Senha atual incorreta.');
    }

    if (user.email === newEmail) {
      throw new BadRequestException('O novo email é igual ao atual.');
    }

    const emailTaken = await this.prisma.user.findUnique({
      where: { email: newEmail },
    });

    if (emailTaken) {
      throw new ConflictException('Este email já está em uso.');
    }

    await this.prisma.emailChangeToken.deleteMany({
      where: { userId },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.emailChangeToken.create({
      data: {
        token: tokenHash,
        userId,
        newEmail,
        expiresAt,
      },
    });

    const confirmUrl = `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/settings/confirm-email?token=${token}`;

    // TODO: enviar por e-mail real. Enquanto não há mailer, o token é
    // devolvido no corpo como canal de entrega para o frontend.
    void confirmUrl;

    return {
      message:
        'Email de confirmação enviado. Verifique sua caixa de entrada para confirmar a troca.',
      token,
    };
  }

  async confirmEmailChange(token: string) {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.emailChangeToken.findUnique({
      where: { token: tokenHash },
    });

    if (!record) {
      throw new BadRequestException('Token de confirmação inválido.');
    }

    if (record.expiresAt < new Date()) {
      await this.prisma.emailChangeToken.delete({
        where: { id: record.id },
      });
      throw new BadRequestException('Token de confirmação expirado.');
    }

    const emailTaken = await this.prisma.user.findUnique({
      where: { email: record.newEmail },
    });

    if (emailTaken) {
      throw new ConflictException('Este email já está em uso.');
    }

    await this.prisma.user.update({
      where: { id: record.userId },
      data: { email: record.newEmail },
    });

    await this.prisma.emailChangeToken.delete({
      where: { id: record.id },
    });

    return { message: 'Email alterado com sucesso.' };
  }

  // ── Settings: change password ──────────────────────────────────────

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Senha atual incorreta.');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'A nova senha deve ser diferente da atual.',
      );
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    await this.revokeAllUserRefreshTokens(userId);

    return { message: 'Senha alterada com sucesso.' };
  }

  // ── Settings: update profile ───────────────────────────────────────

  async updateProfile(userId: string, name?: string) {
    const data: Record<string, string> = {};
    if (name !== undefined) data.name = name;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nada para atualizar.');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  // ── Token internals ─────────────────────────────────────────────────

  private async getTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role, jti: crypto.randomUUID() };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as StringValue,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
        ) as StringValue,
      }),
    ]);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  private async createRefreshToken(
    userId: string,
    token: string,
  ): Promise<void> {
    const expiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d';

    let expiresAt: Date;
    if (expiresIn.endsWith('d')) {
      const days = parseInt(expiresIn.slice(0, -1));
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    } else if (expiresIn.endsWith('h')) {
      const hours = parseInt(expiresIn.slice(0, -1));
      expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    } else if (expiresIn.endsWith('m')) {
      const minutes = parseInt(expiresIn.slice(0, -1));
      expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    } else {
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    const hashedToken = this.hashToken(token);

    await this.prisma.refreshToken.create({
      data: {
        token: hashedToken,
        userId,
        expiresAt,
      },
    });
  }

  private async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { token: tokenHash },
    });

    if (count === 0) {
      throw new NotFoundException('Refresh token não encontrado.');
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
