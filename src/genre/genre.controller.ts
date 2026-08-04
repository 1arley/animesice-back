import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { GenreService } from '@/genre/genre.service';

@ApiTags('genre')
@Controller('genre')
export class GenreController {
  constructor(private readonly genreService: GenreService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos os gêneros' })
  @ApiResponse({
    status: 200,
    description: 'Lista de gêneros retornada com sucesso',
  })
  findAll() {
    return this.genreService.findAll();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Buscar gênero por slug com animes relacionados' })
  @ApiResponse({ status: 200, description: 'Gênero encontrado' })
  @ApiResponse({ status: 404, description: 'Gênero não encontrado' })
  findBySlug(@Param('slug') slug: string) {
    return this.genreService.findBySlug(slug);
  }
}
