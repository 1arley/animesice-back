import { ForbiddenException } from '@nestjs/common';
import { hasActiveRestriction } from '@/common/moderation-state';
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
import type { Prisma } from '@prisma/client';

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
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m';
    const maxAge = this.parseDuration(expiresIn, 15 * 60 * 1000);

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
    const refreshOpts = this.getRefreshCookieOptions();
    res.cookie('access_token', accessToken, opts);
    res.cookie('refresh_token', refreshToken, refreshOpts);
    res.cookie('role', role, { ...refreshOpts, httpOnly: false });
  }

  clearAuthCookies(res: Response) {
    const opts = this.getCookieOptions();
    const refreshOpts = this.getRefreshCookieOptions();
    res.clearCookie('access_token', opts);
    res.clearCookie('refresh_token', refreshOpts);
    res.clearCookie('role', { ...refreshOpts, httpOnly: false });
  }

  // ── Auth flows ──────────────────────────────────────────────────────

  async register(registerDto: RegisterDto) {
    const registration = await this.prisma.siteSetting.findUnique({
      where: { key: 'REGISTRATION_OPEN' },
    });
    if ((registration?.value ?? process.env.REGISTRATION_OPEN) === 'false') {
      throw new ForbiddenException('Novos cadastros estão fechados.');
    }
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
        const sent = await this.mailService.sendVerificationCode(email, code);
        if (!sent) {
          this.logger.warn(`verification email não enviado p/ ${email}`);
        }
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
      const sent = await this.mailService.sendVerificationCode(email, code);
      if (!sent) {
        this.logger.warn(`verification email não enviado p/ ${email}`);
      }

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

    if (await hasActiveRestriction(this.prisma, user.id, ['BAN'])) {
      throw new ForbiddenException('Sua conta está banida.');
    }

    const family = crypto.randomUUID();
    const tokens = await this.generateAndStoreTokens(
      user.id,
      user.email,
      user.role,
      family,
    );

    const { password: _, featuredRemainder, ...userWithoutPassword } = user;

    return {
      ...tokens,
      user: {
        ...userWithoutPassword,
        featuredRemainder: String(featuredRemainder ?? 0n),
      },
    };
  }

  async refreshTokens(userId: string, currentRefreshToken: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const tokenHash = this.hashToken(currentRefreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token inválido.');
    }

    // Reuse detection: if this token was already rotated, the family is
    // compromised — revoke every token in the chain.
    if (storedToken.replacedAt) {
      const family = storedToken.family || storedToken.id;
      await this.revokeRefreshTokenFamily(family, storedToken.id);
      this.logger.warn(
        `Refresh token reuse detected for user ${userId}, family ${family} — all tokens revoked.`,
      );
      throw new UnauthorizedException(
        'Sessão comprometida. Faça login novamente.',
      );
    }

    const family = storedToken.family || storedToken.id;

    const [accessToken, newRefreshToken] = await Promise.all([
      this.generateAccessToken(userId, user.email, user.role),
      this.prisma.$transaction(async (tx) => {
        const claimed = await tx.refreshToken.updateMany({
          where: {
            id: storedToken.id,
            userId,
            replacedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { replacedAt: new Date() },
        });

        if (claimed.count !== 1) return null;

        return this.createRefreshToken(
          userId,
          user.email,
          user.role,
          family,
          tx,
        );
      }),
    ]);

    if (!newRefreshToken) {
      await this.revokeRefreshTokenFamily(family, storedToken.id);
      throw new UnauthorizedException(
        'Sessão comprometida. Faça login novamente.',
      );
    }

    const { password: _, featuredRemainder, ...userWithoutPassword } = user;

    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      user: {
        ...userWithoutPassword,
        featuredRemainder: String(featuredRemainder ?? 0n),
      },
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

    const sent = await this.mailService.sendEmailChangeConfirm(
      normalizedNewEmail,
      confirmUrl,
    );
    if (!sent) {
      this.logger.warn(
        `change-confirm email não enviado p/ ${normalizedNewEmail}`,
      );
    }

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

    const sent = await this.mailService.sendPasswordResetEmail(
      user.email,
      resetUrl,
    );
    if (!sent) {
      this.logger.warn(`password-reset email não enviado p/ ${user.email}`);
    }

    return {
      message: 'Se o email existir, um link de redefinição foi enviado.',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = this.hashToken(token);
    await this.prisma.$transaction(async (tx) => {
      const record = await tx.passwordResetToken.findUnique({
        where: { token: tokenHash },
      });
      if (!record) {
        throw new BadRequestException('Token de redefinição inválido.');
      }
      if (record.expiresAt < new Date()) {
        await tx.passwordResetToken.delete({ where: { id: record.id } });
        throw new BadRequestException('Token de redefinição expirado.');
      }
      const consumed = await tx.passwordResetToken.deleteMany({
        where: { id: record.id, token: tokenHash },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException('Token de redefinição inválido.');
      }
      const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await tx.user.update({
        where: { id: record.userId },
        data: { password: hashed },
      });
      await tx.refreshToken.deleteMany({ where: { userId: record.userId } });
    });

    return { message: 'Senha redefinida com sucesso.' };
  }

  async verifyEmail(email: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(email) },
    });

    if (!user) {
      // Generic response — avoids enumerating registered emails.
      return { message: 'Código de verificação inválido.' };
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

  private async generateAccessToken(
    userId: string,
    email: string,
    role: string,
  ): Promise<string> {
    const payload = { sub: userId, email, role, jti: crypto.randomUUID() };
    return this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get<string>(
        'JWT_ACCESS_EXPIRES_IN',
      ) as StringValue,
    });
  }

  private async createRefreshToken(
    userId: string,
    email: string,
    role: string,
    family: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<string> {
    const payload = { sub: userId, email, role, jti: crypto.randomUUID() };
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>(
        'JWT_REFRESH_EXPIRES_IN',
      ) as StringValue,
    });

    const hashedToken = this.hashToken(refreshToken);
    const expiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d';
    const maxAge = this.parseDuration(expiresIn, 30 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() + maxAge);

    await tx.refreshToken.create({
      data: { token: hashedToken, userId, family, expiresAt },
    });

    return refreshToken;
  }

  private async generateAndStoreTokens(
    userId: string,
    email: string,
    role: string,
    family: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(userId, email, role),
      this.createRefreshToken(userId, email, role, family),
    ]);

    return { access_token: accessToken, refresh_token: refreshToken };
  }

  private async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  private async revokeRefreshTokenFamily(
    family: string,
    legacyTokenId: string,
  ): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ family }, { id: legacyTokenId }] },
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
