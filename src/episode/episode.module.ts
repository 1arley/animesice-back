import { Module } from '@nestjs/common';
import { EpisodeService } from '@/episode/episode.service';
import { EpisodeController } from '@/episode/episode.controller';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EpisodeController],
  providers: [EpisodeService],
  exports: [EpisodeService],
})
export class EpisodeModule {}
