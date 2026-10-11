import { Module } from '@nestjs/common';
import { AvatarController } from '@/upload/avatar.controller';
import { AvatarService } from '@/upload/avatar.service';
import { ProfileCoverController } from '@/upload/profile-cover.controller';

@Module({
  controllers: [AvatarController, ProfileCoverController],
  providers: [AvatarService],
  exports: [AvatarService],
})
export class UploadModule {}
