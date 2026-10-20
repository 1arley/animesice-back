import { Module } from '@nestjs/common';
import { WatchHistoryService } from '@/watch-history/watch-history.service';
import { WatchHistoryController } from '@/watch-history/watch-history.controller';
import { GachaModule } from '@/gacha/gacha.module';

@Module({
  imports: [GachaModule],
  controllers: [WatchHistoryController],
  providers: [WatchHistoryService],
  exports: [WatchHistoryService],
})
export class WatchHistoryModule {}
