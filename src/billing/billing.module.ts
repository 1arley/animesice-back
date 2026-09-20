import { Module } from '@nestjs/common';
import { GachaModule } from '@/gacha/gacha.module';
import { GachaBypassController } from '@/billing/gacha-bypass.controller';
import { LivePixService } from '@/billing/livepix.service';
import { CrystalPurchaseController } from '@/billing/crystal-purchase.controller';
import { CrystalPurchaseService } from '@/billing/crystal-purchase.service';

@Module({
  imports: [GachaModule],
  controllers: [GachaBypassController, CrystalPurchaseController],
  providers: [LivePixService, CrystalPurchaseService],
})
export class BillingModule {}
