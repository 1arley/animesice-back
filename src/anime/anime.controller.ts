import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AnimeService } from '@/anime/anime.service';

@ApiTags('anime')
@Controller('anime')
export class AnimeController {
  constructor(private readonly animeService: AnimeService) {}

  @Get()
  @ApiOperation({ summary: 'Listar animes (paginado)' })
  @ApiResponse({
    status: 200,
    description: 'Lista de animes retornada com sucesso',
  })
  findAll(@Query('page') page: string, @Query('limit') limit: string) {
    return this.animeService.findAll(page, limit);
  }

  @Get('latest-episodes')
  @ApiOperation({ summary: 'Últimos episódios adicionados' })
  @ApiResponse({
    status: 200,
    description: 'Últimos episódios retornados com sucesso',
  })
  findLatestEpisodes(@Query('limit') limit: string) {
    return this.animeService.findLatestEpisodes(
      parseInt(limit ?? '12', 10) || 12,
    );
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Buscar anime por slug' })
  @ApiResponse({ status: 200, description: 'Anime encontrado' })
  @ApiResponse({ status: 404, description: 'Anime não encontrado' })
  findBySlug(@Param('slug') slug: string) {
    return this.animeService.findBySlug(slug);
  }

  @Get(':slug/episodes')
  @ApiOperation({ summary: 'Listar episódios de um anime' })
  @ApiResponse({ status: 200, description: 'Episódios retornados com sucesso' })
  findEpisodes(@Param('slug') slug: string) {
    return this.animeService.findEpisodesBySlug(slug);
  }
}
