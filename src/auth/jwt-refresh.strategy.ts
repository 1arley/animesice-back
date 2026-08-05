import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtPayload } from '@/auth/interfaces/jwt-payload.interface';
import { Request } from 'express';
import * as crypto from 'crypto';

const refreshCookieExtractor = (req: Request | null): string | null => {
  const token = req?.cookies?.['refresh_token'] as string | undefined;
  return token ?? null;
};

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        refreshCookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    const cookieToken = req.cookies?.['refresh_token'] as string | undefined;
    const refreshToken: string | null =
      cookieToken ||
      (req.get('Authorization')
        ? req.get('Authorization')!.replace('Bearer', '').trim()
        : null);

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) throw new UnauthorizedException('Usuário não encontrado.');

    const refreshTokens = await this.prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (refreshTokens.length === 0) {
      throw new UnauthorizedException(
        'Nenhum refresh token válido encontrado.',
      );
    }

    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');
    let tokenValid = false;
    for (const storedToken of refreshTokens) {
      if (tokenHash === storedToken.token) {
        tokenValid = true;
        break;
      }
    }

    if (!tokenValid) {
      throw new UnauthorizedException(
        'Refresh token inválido ou não corresponde ao usuário.',
      );
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      refreshToken,
    };
  }
}
