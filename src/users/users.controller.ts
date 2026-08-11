import {
  Controller,
  Get,
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
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Perfil público de um usuário' })
  @ApiResponse({ status: 200, description: 'Perfil público retornado' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado' })
  getPublicProfile(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
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
