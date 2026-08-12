import { Module, forwardRef } from '@nestjs/common';
import { EmbedService } from '@/embed/embed.service';
import { EmbedController } from '@/embed/embed.controller';
import { ScrapeService } from '@/embed/scrape/scrape.service';
import { AnimefireScrapeSource } from '@/embed/scrape/animefire.source';
import { AnimesonlineccScrapeSource } from '@/embed/scrape/animesonlinecc.source';
import { MeusanimesScrapeSource } from '@/embed/scrape/meusanimes.source';
import { PrismaModule } from '@/prisma/prisma.module';
import { WatchtowerModule } from '@/watchtower/watchtower.module';
import { MetricsService } from '@/metrics/metrics.service';

/**
 * EmbedModule — proxy de mídia/HTML + orquestração de scraping multi-fonte.
 *
 * Importa WatchtowerModule (forwardRef) para consumir o HealthMonitor
 * (ranking/failure dos providers) no hot path do ScrapeService.
 */
@Module({
  imports: [PrismaModule, forwardRef(() => WatchtowerModule)],
  controllers: [EmbedController],
  providers: [
    EmbedService,
    // Scrape multi-fonte (adapters de extração + orquestrador).
    AnimefireScrapeSource,
    AnimesonlineccScrapeSource,
    MeusanimesScrapeSource,
    ScrapeService,
    MetricsService,
  ],
  exports: [EmbedService, ScrapeService, MetricsService],
})
export class EmbedModule {}
