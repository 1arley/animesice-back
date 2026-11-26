import { Module } from '@nestjs/common';
import { SocialService } from '@/social/social.service';
import { SocialController } from '@/social/social.controller';
import { NotificationModule } from '@/notification/notification.module';
import { GachaModule } from '@/gacha/gacha.module';

@Module({
  imports: [NotificationModule, GachaModule],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
