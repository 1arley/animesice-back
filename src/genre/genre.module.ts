import { Module } from '@nestjs/common';
import { GenreService } from '@/genre/genre.service';
import { GenreController } from '@/genre/genre.controller';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GenreController],
  providers: [GenreService],
  exports: [GenreService],
})
export class GenreModule {}
