import { Module } from '@nestjs/common';
import { AdminService } from '@/admin/admin.service';
import { AdminController } from '@/admin/admin.controller';
import { AniListService } from '@/admin/anilist.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { UploadModule } from '@/upload/upload.module';

@Module({
  imports: [PrismaModule, UploadModule],
  controllers: [AdminController],
  providers: [AdminService, AniListService],
})
export class AdminModule {}
