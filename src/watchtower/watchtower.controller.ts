/**
 * WatchtowerController — endpoints admin do Watchtower (guard SUPERADMIN).
 *
 * Rotas:
 *  GET  /admin/watchtower/status      → stats fila + health fontes
 *  POST /admin/watchtower/check/:slug  → força release-check de um anime
 *  POST /admin/watchtower/jobs/:id/retry → reenfileira job DEAD/FAILED
 *  POST /admin/watchtower/sources/:id/toggle → liga/desliga fonte
 *  POST /admin/watchtower/discover    → força season discovery
 *  POST /admin/watchtower/repair      → força repair sweep
 */
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { PrismaService } from '@/prisma/prisma.service';
import { JobsService } from './jobs.service';
import { ReleaseMonitor } from './release-monitor.service';
import { SeasonDiscovery } from './season-discovery.service';
import { RepairWorker } from './repair-worker.service';
import { CatalogScanner } from './catalog-scanner.service';

@ApiTags('Watchtower')
@ApiBearerAuth()
@Controller('admin/watchtower')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
export class WatchtowerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly release: ReleaseMonitor,
    private readonly season: SeasonDiscovery,
    private readonly repair: RepairWorker,
    private readonly catalog: CatalogScanner,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Status da fila e saúde das fontes' })
  async status() {
    const [jobStats, sources] = await Promise.all([
      this.jobs.stats(),
      this.prisma.watchtowerSourceHealth.findMany(),
    ]);
    return { jobs: jobStats, sources };
  }

  @Post('check/:slug')
  @ApiOperation({ summary: 'Força verificação de lançamentos de um anime' })
  async check(@Param('slug') slug: string) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug },
      select: { id: true, title: true },
    });
    if (!anime) return { error: 'Anime não encontrado' };
    const enqueued = await this.release.checkOne(anime.id);
    return { anime: anime.title, enqueued };
  }

  @Post('jobs/:id/retry')
  @ApiOperation({ summary: 'Reenfileira job DEAD/FAILED' })
  async retry(@Param('id') id: string) {
    await this.prisma.watchtowerJob
      .update({
        where: { id },
        data: {
          status: 'PENDING',
          attempts: 0,
          nextRunAt: new Date(),
          lastError: null,
        },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  @Post('sources/:id/toggle')
  @ApiOperation({ summary: 'Liga/desliga fonte' })
  async toggle(@Param('id') id: string, @Body() body: { disabled: boolean }) {
    await this.prisma.watchtowerSourceHealth.upsert({
      where: { sourceId: id },
      update: { disabled: body.disabled, consecutiveFailures: 0 },
      create: { sourceId: id, disabled: body.disabled },
    });
    return { sourceId: id, disabled: body.disabled };
  }

  @Post('discover')
  @ApiOperation({ summary: 'Força descoberta de temporada' })
  async discover() {
    const created = await this.season.discover();
    return { created };
  }

  @Post('repair')
  @ApiOperation({ summary: 'Força varredura de reparo' })
  async repairSweep() {
    const enqueued = await this.repair.sweep();
    return { enqueued };
  }

  @Post('scan-all')
  @ApiOperation({ summary: 'Força escaneamento de catálogo de todos animes' })
  async scanAll(@Body() body?: { force?: boolean }) {
    const res = await this.catalog.scanAll(body?.force ?? false);
    return res;
  }
}
