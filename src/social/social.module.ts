import { Module } from '@nestjs/common';
import { SocialService } from '@/social/social.service';
import { SocialController } from '@/social/social.controller';
import { NotificationModule } from '@/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
