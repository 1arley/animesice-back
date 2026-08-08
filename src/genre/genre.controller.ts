import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { GenreService } from '@/genre/genre.service';

@ApiTags('genre')
@Controller('genre')
export class GenreController {
  constructor(private readonly genreService: GenreService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos os gêneros com contagem de animes' })
  @ApiResponse({
    status: 200,
    description: 'Lista de gêneros retornada com sucesso',
  })
  findAll() {
    return this.genreService.findAll();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Buscar gênero por slug' })
  @ApiResponse({ status: 200, description: 'Gênero encontrado' })
  @ApiResponse({ status: 404, description: 'Gênero não encontrado' })
  findBySlug(@Param('slug') slug: string) {
    return this.genreService.findBySlug(slug);
  }

  @Get(':slug/animes')
  @ApiOperation({ summary: 'Listar animes de um gênero (paginado)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Animes do gênero retornados' })
  @ApiResponse({ status: 404, description: 'Gênero não encontrado' })
  findAnimesBySlug(
    @Param('slug') slug: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.genreService.findAnimesBySlug(slug, page, limit);
  }
}
