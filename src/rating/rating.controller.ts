import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RatingService } from '@/rating/rating.service';
import { RateAnimeDto } from '@/rating/dto/rate-anime.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('rating')
@Controller('rating')
export class RatingController {
  constructor(private readonly ratingService: RatingService) {}

  @Post(':slug')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Avaliar anime (1-10)' })
  @ApiResponse({ status: 201, description: 'Avaliação registrada' })
  @ApiResponse({ status: 404, description: 'Anime não encontrado' })
  @ApiResponse({
    status: 403,
    description: 'Conta não verificada',
  })
  rate(
    @Req() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Body() dto: RateAnimeDto,
  ) {
    return this.ratingService.rate(req.user.id, slug, dto);
  }

  @Delete(':slug')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Remover avaliação' })
  @ApiResponse({
    status: 403,
    description: 'Conta não verificada',
  })
  remove(@Req() req: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.ratingService.remove(req.user.id, slug);
  }

  @Get('me/:slug')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Obter minha avaliação de um anime' })
  @ApiResponse({
    status: 403,
    description: 'Conta não verificada',
  })
  getUserRating(@Req() req: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.ratingService.getUserRating(req.user.id, slug);
  }

  @Get('stats/:slug')
  @ApiOperation({ summary: 'Estatísticas de avaliação de um anime' })
  getStats(@Param('slug') slug: string) {
    return this.ratingService.getAnimeStats(slug);
  }
}
