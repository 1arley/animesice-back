import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { ReportUserDto } from './dto/report-user.dto';
import {
  UpdateCropsDto,
  UpdateProfileBackgroundDto,
  UpdateShowcaseSectionsDto,
} from './dto/profile-showcase.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '@/auth/optional-jwt-auth.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import type { Request } from 'express';

/** Request que pode (ou não) ter usuário — rotas com OptionalJwtAuthGuard. */
type OptionalAuthRequest = Request & { user?: AuthenticatedRequest['user'] };

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Diretório de usuários com perfil público (busca e ordenações da comunidade)',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de usuários' })
  searchUsers(
    @Req() req: OptionalAuthRequest,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.searchUsers(
      req.user?.id ?? null,
      search,
      sort,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '24', 10) || 24,
    );
  }

  @Get('profile-backgrounds')
  @ApiOperation({ summary: 'Galeria de fundos de perfil disponíveis' })
  listProfileBackgrounds() {
    return this.usersService.listProfileBackgrounds();
  }

  @Patch('me/crops')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Ajustar o recorte do avatar e da capa (null = padrão)',
  })
  updateCrops(@Req() req: AuthenticatedRequest, @Body() dto: UpdateCropsDto) {
    return this.usersService.updateCrops(req.user.id, dto);
  }

  @Patch('me/showcase-sections')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Reordenar as seções do showcase do perfil' })
  updateShowcaseSections(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateShowcaseSectionsDto,
  ) {
    return this.usersService.updateShowcaseSections(req.user.id, dto.sections);
  }

  @Patch('me/profile-background')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Trocar o fundo do perfil (null = sem fundo)' })
  updateProfileBackground(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileBackgroundDto,
  ) {
    return this.usersService.setProfileBackground(req.user.id, dto.key ?? null);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Perfil público de um usuário' })
  @ApiResponse({ status: 200, description: 'Perfil público retornado' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado' })
  getPublicProfile(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
  }

  @Get(':id/showcase')
  @ApiOperation({
    summary:
      'Showcase do perfil (carta em destaque, favoritas, coleção e medalhas)',
  })
  @ApiResponse({ status: 200, description: 'Showcase do perfil' })
  @ApiResponse({
    status: 404,
    description: 'Usuário não encontrado ou privado',
  })
  getShowcase(@Param('id') id: string) {
    return this.usersService.getShowcase(id);
  }

  @Get(':id/hover')
  @ApiOperation({ summary: 'Mini-cartão do perfil para hover' })
  @ApiResponse({ status: 200, description: 'Mini-cartão' })
  @ApiResponse({
    status: 404,
    description: 'Usuário não encontrado ou privado',
  })
  getHoverCard(@Param('id') id: string) {
    return this.usersService.getHoverCard(id);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Comentários públicos de um usuário' })
  @ApiResponse({ status: 200, description: 'Lista de comentários' })
  getUserComments(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.usersService.getUserComments(
      id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get(':id/ratings')
  @ApiOperation({ summary: 'Avaliações públicas de um usuário' })
  @ApiResponse({ status: 200, description: 'Lista de avaliações' })
  getUserRatings(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.usersService.getUserRatings(
      id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get(':id/favorites')
  @ApiOperation({ summary: 'Animes favoritados por um usuário' })
  @ApiResponse({ status: 200, description: 'Lista de favoritos' })
  getUserFavorites(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.usersService.getUserFavorites(
      id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get(':id/anime-list')
  @ApiOperation({
    summary: 'Lista de animes (biblioteca) pública de um usuário',
  })
  @ApiResponse({ status: 200, description: 'Lista pública da biblioteca' })
  getUserAnimeList(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status?: string,
  ) {
    return this.usersService.getUserAnimeList(
      id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '24', 10) || 24,
      status,
    );
  }

  @Get(':id/activity')
  @ApiOperation({
    summary: 'Atividade pública recente de um usuário (feed cronológico)',
  })
  @ApiResponse({ status: 200, description: 'Feed de atividade pública' })
  getUserActivity(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.usersService.getUserActivity(
      id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Estatísticas públicas de um usuário' })
  @ApiResponse({ status: 200, description: 'Estatísticas do perfil' })
  getUserStats(@Param('id') id: string) {
    return this.usersService.getUserStats(id);
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Denunciar usuário' })
  @ApiResponse({ status: 201, description: 'Denúncia criada' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado' })
  reportUser(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ReportUserDto,
  ) {
    return this.usersService.reportUser(req.user.id, id, dto.reason, dto.notes);
  }
}
