import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EpisodeService } from '@/episode/episode.service';
import { MAX_PAGE_SIZE } from '@/common/constants';

@ApiTags('episode')
@Controller('episode')
export class EpisodeController {
  constructor(private readonly episodeService: EpisodeService) {}

  @Get('latest')
  @ApiOperation({ summary: 'Últimos episódios adicionados' })
  @ApiResponse({ status: 200, description: 'Últimos episódios' })
  findLatest(@Query('limit') limit: string) {
    const parsed = parseInt(limit ?? '12', 10);
    const clamped = Number.isNaN(parsed) || parsed < 1 ? 12 : parsed;
    return this.episodeService.findLatest(Math.min(clamped, MAX_PAGE_SIZE));
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Listar episódios de um anime por slug' })
  @ApiResponse({ status: 200, description: 'Episódios retornados' })
  @ApiResponse({ status: 404, description: 'Anime não encontrado' })
  findByAnimeSlug(@Param('slug') slug: string) {
    return this.episodeService.findByAnimeSlug(slug);
  }

  @Get(':slug/:number')
  @ApiOperation({ summary: 'Buscar episódio específico por slug e número' })
  @ApiResponse({ status: 200, description: 'Episódio encontrado' })
  @ApiResponse({ status: 404, description: 'Anime ou episódio não encontrado' })
  findByAnimeSlugAndNumber(
    @Param('slug') slug: string,
    @Param('number', ParseIntPipe) number: number,
  ) {
    return this.episodeService.findByAnimeSlugAndNumber(slug, number);
  }
}
