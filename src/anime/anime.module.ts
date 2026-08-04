import { Module } from '@nestjs/common';
import { AnimeService } from '@/anime/anime.service';
import { AnimeController } from '@/anime/anime.controller';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AnimeController],
  providers: [AnimeService],
  exports: [AnimeService],
})
export class AnimeModule {}
