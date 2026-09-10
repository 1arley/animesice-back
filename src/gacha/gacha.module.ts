import { Module } from '@nestjs/common';
import { GachaService } from '@/gacha/gacha.service';
import { GachaController } from '@/gacha/gacha.controller';
import { TurnstileService } from '@/auth/turnstile/turnstile.service';

@Module({
  controllers: [GachaController],
  providers: [GachaService, TurnstileService],
  exports: [GachaService],
})
export class GachaModule {}
