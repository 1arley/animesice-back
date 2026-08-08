import { Controller, Get, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RecommendationService } from '@/recommendation/recommendation.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('recommendation')
@Controller('recommendation')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Recomendações personalizadas' })
  getPersonalized(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    return this.recommendationService.getPersonalized(
      req.user.id,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get('similar/:slug')
  @ApiOperation({ summary: 'Animes similares por gênero' })
  getSimilar(@Param('slug') slug: string, @Query('limit') limit?: string) {
    return this.recommendationService.getSimilar(
      slug,
      parseInt(limit ?? '12', 10) || 12,
    );
  }

  @Get('because-you-watched')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Recomendações baseadas no histórico' })
  getBecauseYouWatched(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    return this.recommendationService.getBecauseYouWatched(
      req.user.id,
      parseInt(limit ?? '12', 10) || 12,
    );
  }
}
