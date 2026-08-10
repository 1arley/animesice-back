import { Module } from '@nestjs/common';
import { AdminService } from '@/admin/admin.service';
import { AdminController } from '@/admin/admin.controller';
import { AuditController } from '@/admin/audit.controller';
import { AniListService } from '@/admin/anilist.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { UploadModule } from '@/upload/upload.module';
import { NotificationModule } from '@/notification/notification.module';
import { AuditService } from '@/common/services/audit.service';

@Module({
  imports: [PrismaModule, UploadModule, NotificationModule],
  controllers: [AdminController, AuditController],
  providers: [AdminService, AniListService, AuditService],
})
export class AdminModule {}
