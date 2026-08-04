import { Module } from '@nestjs/common';
import { EmbedService } from '@/embed/embed.service';
import { EmbedController } from '@/embed/embed.controller';
import { AnimefireScrapeService } from '@/embed/animefire-scrape.service';

@Module({
  controllers: [EmbedController],
  providers: [EmbedService, AnimefireScrapeService],
  exports: [EmbedService, AnimefireScrapeService],
})
export class EmbedModule {}
