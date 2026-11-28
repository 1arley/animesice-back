import { Module } from '@nestjs/common';
import { GachaService } from '@/gacha/gacha.service';
import { GachaController } from '@/gacha/gacha.controller';
import { GachaConfigService } from '@/gacha/gacha-config.service';
import { WishlistService } from '@/gacha/wishlist.service';
import { EconomyController } from '@/gacha/economy/economy.controller';
import { EconomyService } from '@/gacha/economy/economy.service';
import { RouletteService } from '@/gacha/economy/roulette.service';
import { CrystalAccountingService } from '@/gacha/crystal-accounting.service';
import { NotificationModule } from '@/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [GachaController, EconomyController],
  providers: [
    GachaService,
    CrystalAccountingService,
    GachaConfigService,
    WishlistService,
    EconomyService,
    RouletteService,
  ],
  exports: [
    GachaService,
    GachaConfigService,
    WishlistService,
    EconomyService,
    RouletteService,
    CrystalAccountingService,
  ],
})
export class GachaModule {}
