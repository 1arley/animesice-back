import { Module } from '@nestjs/common';
import { GachaModule } from '@/gacha/gacha.module';
import { GachaBypassController } from '@/billing/gacha-bypass.controller';
import { LivePixService } from '@/billing/livepix.service';

@Module({
  imports: [GachaModule],
  controllers: [GachaBypassController],
  providers: [LivePixService],
})
export class BillingModule {}
