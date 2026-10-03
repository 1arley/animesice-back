import { Module } from '@nestjs/common';
import { AvatarController } from '@/upload/avatar.controller';
import { AvatarService } from '@/upload/avatar.service';

@Module({
  controllers: [AvatarController],
  providers: [AvatarService],
  exports: [AvatarService],
})
export class UploadModule {}
