import { Module } from '@nestjs/common';
import { ModerationService } from '@/moderation/moderation.service';
import { ModerationController } from '@/moderation/moderation.controller';
import { NotificationModule } from '@/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
