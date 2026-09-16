import { Module } from '@nestjs/common';
import { AvatarController } from '@/upload/avatar.controller';
import { AvatarService } from '@/upload/avatar.service';
import { SupabaseService } from '@/upload/supabase.service';

@Module({
  controllers: [AvatarController],
  providers: [AvatarService, SupabaseService],
  exports: [AvatarService, SupabaseService],
})
export class UploadModule {}
