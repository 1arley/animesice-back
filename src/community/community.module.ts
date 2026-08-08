import { Module } from '@nestjs/common';
import { CommunityService } from '@/community/community.service';
import { CommunityController } from '@/community/community.controller';

@Module({
  controllers: [CommunityController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
