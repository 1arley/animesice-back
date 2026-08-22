import {
  Injectable,
  Logger,
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
import ms from 'ms';
import type { StringValue } from 'ms';
import { Response } from 'express';
import { BCRYPT_ROUNDS } from '@/common/constants';
import { MailService } from '@/mail/mail.service';
import { TurnstileService } from '@/auth/turnstile/turnstile.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Evita repetir o warning de captcha a cada login/registro. */
  private static captchaMisconfiguredWarned = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly turnstileService: TurnstileService,
  ) {}

  // ── Cookie helpers ──────────────────────────────────────────────────

  private getCookieOptions() {
    const expiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '7d';
    const maxAge = this.parseDuration(expiresIn, 7 * 24 * 60 * 60 * 1000);

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
    const maxAge = this.parseDuration(
      refreshExpiresIn,
      30 * 24 * 60 * 60 * 1000,
    );
    return { ...opts, maxAge };
  }

  /** Parseia duração (ex: "7d", "12h", "30m", "900s") via ms(); fallback seguro. */
  private parseDuration(value: string, fallbackMs: number): number {
    try {
      const parsed = ms(value as ms.StringValue);
      if (typeof parsed === 'number' && parsed > 0) return parsed;
    } catch {
      /* valor inválido — usa fallback */
    }
    return fallbackMs;
  }

  setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    role: string,
  ) {
    const opts = this.getCookieOptions();
    res.cookie('access_token', accessToken, opts);
    res.cookie('refresh_token', refreshToken, this.getRefreshCookieOptions());
    res.cookie('role', role, { ...opts, httpOnly: false });
  }

  clearAuthCookies(res: Response) {
    const opts = this.getCookieOptions();
    res.clearCookie('access_token', opts);
    res.clearCookie('refresh_token', this.getRefreshCookieOptions());
    res.clearCookie('role', { ...opts, httpOnly: false });
  }

  // ── Auth flows ──────────────────────────────────────────────────────

  async register(registerDto: RegisterDto) {
    const { name, userName, password } = registerDto;
    const email = this.normalizeEmail(registerDto.email);

    if (this.shouldVerifyCaptcha()) {
      await this.turnstileService.verify(registerDto.turnstileToken);
    }

    const normalizedUserName = this.normalizeUserName(userName);
    if (normalizedUserName) {
      await this.ensureUserNameUnique(normalizedUserName);
    }

    const userExists = await this.prisma.user.findUnique({
      where: { email },
    });

    if (userExists) {
      // Unverified user re-registering — update password/name and resend code.
      // Response genérica p/ não vazar se o email está registrado (enumeração).
      if (!userExists.isVerified) {
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await this.prisma.user.update({
          where: { id: userExists.id },
          data: {
            password: hashedPassword,
            name,
            ...(normalizedUserName ? { userName: normalizedUserName } : {}),
          },
        });

        await this.prisma.emailVerificationCode.deleteMany({
          where: { userId: userExists.id },
        });
        const code = await this.createVerificationCode(userExists.id);
        await this.mailService.sendVerificationCode(email, code);
      }

      return {
        message:
          'Conta criada. Verifique seu email para o código de verificação.',
      };
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: 'USER',
          isVerified: false,
          ...(normalizedUserName ? { userName: normalizedUserName } : {}),
        },
      });

      const code = await this.createVerificationCode(user.id);
      await this.mailService.sendVerificationCode(email, code);

      return {
        message:
          'Conta criada. Verifique seu email para o código de verificação.',
      };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('Este apelido já está em uso.');
      }
      throw err;
    }
  }

  async login(loginDto: LoginDto) {
    const { password } = loginDto;
    const email = this.normalizeEmail(loginDto.email);

    if (this.shouldVerifyCaptcha()) {
      await this.turnstileService.verify(loginDto.turnstileToken);
    }

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

    if (!user.isVerified) {
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

    const { password: _, ...userWithoutPassword } = user;

    return {
      ...tokens,
      user: userWithoutPassword,
    };
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

    const normalizedNewEmail = this.normalizeEmail(newEmail);

    if (user.email.toLowerCase() === normalizedNewEmail) {
      throw new BadRequestException('O novo email é igual ao atual.');
    }

    const emailTaken = await this.prisma.user.findUnique({
      where: { email: normalizedNewEmail },
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
        newEmail: normalizedNewEmail,
        expiresAt,
      },
    });

    const confirmUrl = `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/settings/confirm-email?token=${token}`;

    await this.mailService.sendEmailChangeConfirm(
      normalizedNewEmail,
      confirmUrl,
    );

    return {
      message:
        'Email de confirmação enviado. Verifique sua caixa de entrada para confirmar a troca.',
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

    // Operação atômica: atualiza email + deleta token em uma única transação.
    // Evita token órfão reutilizável se o process crashar entre update e delete.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { email: record.newEmail },
      }),
      this.prisma.emailChangeToken.delete({
        where: { id: record.id },
      }),
    ]);

    // Identidade trocada — derruba sessões existentes.
    await this.revokeAllUserRefreshTokens(record.userId);

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

  async updateProfile(userId: string, name?: string, userName?: string) {
    const data: Record<string, string> = {};
    if (name !== undefined) data.name = name;
    if (userName !== undefined) {
      const normalized = this.normalizeUserName(userName);
      if (normalized) {
        await this.ensureUserNameUnique(normalized, userId);
        data.userName = normalized;
      }
    }

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

  // ── Password reset (forgot/reset) ───────────────────────────────────

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(email) },
    });

    if (!user) {
      return {
        message: 'Se o email existir, um link de redefinição foi enviado.',
      };
    }

    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        token: tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    const resetUrl = `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/redefinir-senha?token=${token}`;

    await this.mailService.sendPasswordResetEmail(user.email, resetUrl);

    return {
      message: 'Se o email existir, um link de redefinição foi enviado.',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
    });

    if (!record) {
      throw new BadRequestException('Token de redefinição inválido.');
    }

    if (record.expiresAt < new Date()) {
      await this.prisma.passwordResetToken.delete({
        where: { id: record.id },
      });
      throw new BadRequestException('Token de redefinição expirado.');
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { password: hashed },
    });

    await this.prisma.passwordResetToken.delete({
      where: { id: record.id },
    });

    await this.revokeAllUserRefreshTokens(record.userId);

    return { message: 'Senha redefinida com sucesso.' };
  }

  async verifyEmail(email: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(email) },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    if (user.isVerified) {
      return { message: 'Conta já verificada.' };
    }

    const record = await this.prisma.emailVerificationCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException(
        'Nenhum código encontrado. Solicite um novo.',
      );
    }

    if (record.attempts >= 5) {
      await this.prisma.emailVerificationCode.delete({
        where: { id: record.id },
      });
      throw new BadRequestException(
        'Muitas tentativas. Solicite um novo código.',
      );
    }

    await this.prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });

    const codeHash = this.hashToken(code);
    if (record.codeHash !== codeHash) {
      throw new BadRequestException('Código de verificação inválido.');
    }

    if (record.expiresAt < new Date()) {
      await this.prisma.emailVerificationCode.delete({
        where: { id: record.id },
      });
      throw new BadRequestException('Código de verificação expirado.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      }),
      this.prisma.emailVerificationCode.delete({
        where: { id: record.id },
      }),
    ]);

    return { message: 'Conta verificada com sucesso.' };
  }

  async resendVerificationCode(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(email) },
    });

    if (!user) {
      // Don't leak whether email exists.
      return { message: 'Se o email existir, um código foi enviado.' };
    }

    if (user.isVerified) {
      return { message: 'Conta já verificada.' };
    }

    await this.prisma.emailVerificationCode.deleteMany({
      where: { userId: user.id },
    });

    const code = await this.createVerificationCode(user.id);
    await this.mailService.sendVerificationCode(user.email, code);

    return { message: 'Código de verificação reenviado.' };
  }

  private async createVerificationCode(userId: string): Promise<string> {
    const code = Array.from({ length: 8 }, () => crypto.randomInt(0, 10)).join(
      '',
    );

    const codeHash = this.hashToken(code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.emailVerificationCode.create({
      data: { codeHash, userId, expiresAt },
    });

    return code;
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

  private normalizeUserName(userName?: string): string | undefined {
    if (userName === undefined || userName === null) return undefined;
    const normalized = userName.trim().toLowerCase();
    return normalized || undefined;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async ensureUserNameUnique(
    userName: string,
    excludeUserId?: string,
  ): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { userName },
    });
    if (existing && existing.id !== excludeUserId) {
      throw new ConflictException('Este apelido já está em uso.');
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    );
  }

  private shouldVerifyCaptcha(): boolean {
    const flag = process.env.TURNSTILE_ENABLED;
    if (flag === 'true') return true;
    if (flag === 'false') return false;

    const secret = process.env.TURNSTILE_SECRET;
    if (!secret) return false;

    // Chaves de TESTE do Cloudflare começam com `1x0000...` (verificação
    // simulada que sempre passa) — não há o que validar no siteverify.
    if (secret.startsWith('1x')) return false;

    // Chaves de PRODUÇÃO têm formato 0x4AAAAAAA... (40 chars). Chaves fora
    // desse formato são config quebrada: degrada para "sem captcha" com
    // warning (evita derrubar login/registro inteiro) até a chave ser
    // corrigida. Obs: o check anterior usava 0x4AAAAA como prefixo de teste,
    // o que desligava o captcha até com chave real de produção.
    if (/^0x4[A-Za-z0-9_-]{37}$/.test(secret)) return true;

    if (!AuthService.captchaMisconfiguredWarned) {
      AuthService.captchaMisconfiguredWarned = true;
      this.logger.warn(
        '[turnstile] TURNSTILE_SECRET não segue o formato de chave de produção (esperado 0x4... com 40 chars) — verificação de captcha desativada até corrigir a chave.',
      );
    }
    return false;
  }
}
