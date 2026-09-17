import { Module } from '@nestjs/common';
import { GachaService } from '@/gacha/gacha.service';
import { GachaController } from '@/gacha/gacha.controller';
import { WishlistService } from '@/gacha/wishlist.service';

@Module({
  controllers: [GachaController],
  providers: [GachaService, WishlistService],
  exports: [GachaService, WishlistService],
})
export class GachaModule {}
