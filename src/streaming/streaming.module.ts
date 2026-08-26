import { Module } from '@nestjs/common';
import { StreamingService } from '@/streaming/streaming.service';
import { StreamingController } from '@/streaming/streaming.controller';
import { ExtractionJobService } from '@/streaming/extraction-job.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmbedModule } from '@/embed/embed.module';

@Module({
  imports: [PrismaModule, EmbedModule],
  controllers: [StreamingController],
  providers: [StreamingService, ExtractionJobService],
  exports: [StreamingService],
})
export class StreamingModule {}
