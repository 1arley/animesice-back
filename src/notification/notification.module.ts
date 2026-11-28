import { Module } from '@nestjs/common';
import { NotificationService } from '@/notification/notification.service';
import { NotificationController } from '@/notification/notification.controller';
import { AdminNotificationController } from '@/notification/admin-notification.controller';
import { AdminNotificationService } from '@/notification/admin-notification.service';
import { AuditService } from '@/common/services/audit.service';

@Module({
  controllers: [NotificationController, AdminNotificationController],
  providers: [NotificationService, AdminNotificationService, AuditService],
  exports: [NotificationService],
})
export class NotificationModule {}
