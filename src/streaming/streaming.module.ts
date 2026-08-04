import { Module } from '@nestjs/common';
import { StreamingService } from '@/streaming/streaming.service';
import { StreamingController } from '@/streaming/streaming.controller';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StreamingController],
  providers: [StreamingService],
  exports: [StreamingService],
})
export class StreamingModule {}
