// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from '@/auth/auth.service';
import { AuthController } from '@/auth/auth.controller';
import { JwtStrategy } from '@/auth/jwt.strategy';
import { JwtRefreshStrategy } from '@/auth/jwt-refresh.strategy';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import { MailModule } from '@/mail/mail.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    JwtAuthGuard,
    RolesGuard,
    VerifiedGuard,
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard, VerifiedGuard],
})
export class AuthModule {}
