import { Module } from '@nestjs/common';
import { EmbedService } from '@/embed/embed.service';
import { EmbedController } from '@/embed/embed.controller';
import { ScrapeService } from '@/embed/scrape/scrape.service';
import { AnimefireScrapeSource } from '@/embed/scrape/animefire.source';
import { AnimesonlineccScrapeSource } from '@/embed/scrape/animesonlinecc.source';
import { MeusanimesScrapeSource } from '@/embed/scrape/meusanimes.source';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EmbedController],
  providers: [
    EmbedService,
    // Scrape multi-fonte (adapters de extração + orquestrador).
    AnimefireScrapeSource,
    AnimesonlineccScrapeSource,
    MeusanimesScrapeSource,
    ScrapeService,
  ],
  exports: [EmbedService, ScrapeService],
})
export class EmbedModule {}
