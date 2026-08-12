/**
 * WatchtowerModule — orquestra catálogo automático do AnimesIce.
 *
 * Imports: PrismaModule, EmbedModule (ScrapeService), NotificationModule.
 *.scheduleModule.forRoot() movido p/ AppModule (evita singleton duplicado).
 */
import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmbedModule } from '@/embed/embed.module';
import { NotificationModule } from '@/notification/notification.module';
import { JobsService } from './jobs.service';
import { AniListClient } from './anilist-client.service';
import { HealthMonitor } from './health-monitor.service';
import { SourceDiscovery } from './source-discovery.service';
import { Validator } from './validator.service';
import { Publisher } from './publisher.service';
import { Extractor } from './extractor.service';
import { ReleaseMonitor } from './release-monitor.service';
import { SeasonDiscovery } from './season-discovery.service';
import { RepairWorker } from './repair-worker.service';
import { WorkerService } from './worker.service';
import { WatchtowerScheduler } from './watchtower.scheduler';
import { CatalogScanner } from './catalog-scanner.service';
import { WatchtowerController } from './watchtower.controller';

@Module({
  imports: [PrismaModule, forwardRef(() => EmbedModule), NotificationModule],
  controllers: [WatchtowerController],
  providers: [
    JobsService,
    AniListClient,
    HealthMonitor,
    SourceDiscovery,
    Validator,
    Publisher,
    Extractor,
    ReleaseMonitor,
    SeasonDiscovery,
    RepairWorker,
    WorkerService,
    WatchtowerScheduler,
    CatalogScanner,
  ],
  exports: [JobsService, HealthMonitor, ReleaseMonitor],
})
export class WatchtowerModule {}
