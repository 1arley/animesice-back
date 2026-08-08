import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AnimeService, type AnimeFilterDto } from '@/anime/anime.service';

@ApiTags('anime')
@Controller('anime')
export class AnimeController {
  constructor(private readonly animeService: AnimeService) {}

  @Get()
  @ApiOperation({ summary: 'Listar animes (paginado, com filtros avançados)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({
    name: 'genres',
    required: false,
    type: String,
    description: 'Slugs separados por vírgula',
  })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({
    name: 'audio',
    required: false,
    type: String,
    enum: ['LEGENDADO', 'DUBLADO'],
  })
  @ApiQuery({
    name: 'format',
    required: false,
    type: String,
    enum: ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'],
  })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({
    name: 'season',
    required: false,
    type: String,
    enum: ['WINTER', 'SPRING', 'SUMMER', 'FALL'],
  })
  @ApiQuery({ name: 'ageRating', required: false, type: String })
  @ApiQuery({ name: 'minScore', required: false, type: Number })
  @ApiQuery({ name: 'maxScore', required: false, type: Number })
  @ApiQuery({
    name: 'sort',
    required: false,
    type: String,
    enum: ['recentlyAdded', 'rating', 'views', 'year', 'title'],
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de animes retornada com sucesso',
  })
  findAll(@Query() filters: AnimeFilterDto) {
    return this.animeService.findAll(filters);
  }

  @Get('random')
  @ApiOperation({ summary: 'Anime aleatório' })
  @ApiResponse({ status: 200, description: 'Anime aleatório retornado' })
  @ApiResponse({ status: 404, description: 'Nenhum anime cadastrado' })
  findRandom() {
    return this.animeService.findRandom();
  }

  @Get('top')
  @ApiOperation({ summary: 'Top animes por nota' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Top animes' })
  findTop(@Query('limit') limit?: string) {
    return this.animeService.findTop(parseInt(limit ?? '20', 10) || 20);
  }

  @Get('trending')
  @ApiOperation({ summary: 'Animes em alta (baseado em views recentes)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'sinceDays',
    required: false,
    type: Number,
    description: 'Janela em dias (padrão 7)',
  })
  @ApiResponse({ status: 200, description: 'Animes em alta' })
  findTrending(
    @Query('limit') limit?: string,
    @Query('sinceDays') sinceDays?: string,
  ) {
    return this.animeService.findTrending(
      parseInt(limit ?? '20', 10) || 20,
      parseInt(sinceDays ?? '7', 10) || 7,
    );
  }

  @Get('recently-added')
  @ApiOperation({ summary: 'Animes recentemente adicionados' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Animes recentes' })
  findRecentlyAdded(@Query('limit') limit?: string) {
    return this.animeService.findRecentlyAdded(
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Calendário de lançamentos por dia da semana' })
  @ApiQuery({ name: 'season', required: false, type: String })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Calendário semanal' })
  findCalendar(@Query('season') season?: string, @Query('year') year?: string) {
    return this.animeService.findCalendar(season, year);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Buscar anime por slug' })
  @ApiResponse({ status: 200, description: 'Anime encontrado' })
  @ApiResponse({ status: 404, description: 'Anime não encontrado' })
  findBySlug(@Param('slug') slug: string) {
    return this.animeService.findBySlug(slug);
  }

  @Get(':slug/related')
  @ApiOperation({ summary: 'Animes relacionados por gênero' })
  @ApiResponse({ status: 200, description: 'Animes relacionados retornados' })
  findRelated(@Param('slug') slug: string) {
    return this.animeService.findRelated(slug);
  }

  @Get(':slug/stats')
  @ApiOperation({ summary: 'Estatísticas do anime (favoritos, ratings)' })
  findStats(@Param('slug') slug: string) {
    return this.animeService.findStats(slug);
  }

  @Get(':slug/episodes')
  @ApiOperation({ summary: 'Listar episódios de um anime' })
  @ApiResponse({ status: 200, description: 'Episódios retornados com sucesso' })
  findEpisodes(@Param('slug') slug: string) {
    return this.animeService.findEpisodesBySlug(slug);
  }
}
