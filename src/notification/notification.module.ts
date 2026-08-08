import { Module } from '@nestjs/common';
import { NotificationService } from '@/notification/notification.service';
import { NotificationController } from '@/notification/notification.controller';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
