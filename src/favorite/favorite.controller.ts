import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FavoriteService } from '@/favorite/favorite.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { DEFAULT_PAGE } from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('favorite')
@Controller('favorite')
export class FavoriteController {
  constructor(private readonly favoriteService: FavoriteService) {}

  @Post(':slug/toggle')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Alternar favorito (favoritar/desfavoritar)' })
  toggle(@Req() req: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.favoriteService.toggle(req.user.id, slug);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Listar animes favoritos do usuário' })
  list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.favoriteService.list(
      req.user.id,
      parseInt(page ?? '1', 10) || DEFAULT_PAGE,
      parseInt(limit ?? '24', 10) || 24,
    );
  }

  @Get(':slug/check')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verificar se anime está favoritado' })
  check(@Req() req: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.favoriteService.check(req.user.id, slug);
  }
}
