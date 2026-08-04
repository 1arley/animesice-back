import { Module } from '@nestjs/common';
import { SupabaseService } from '@/upload/supabase.service';

@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class UploadModule {}
