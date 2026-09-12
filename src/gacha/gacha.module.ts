import { Module } from '@nestjs/common';
import { GachaService } from '@/gacha/gacha.service';
import { GachaController } from '@/gacha/gacha.controller';

@Module({
  controllers: [GachaController],
  providers: [GachaService],
  exports: [GachaService],
})
export class GachaModule {}
