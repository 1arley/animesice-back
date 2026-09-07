import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GachaService } from '@/gacha/gacha.service';
import { RollGachaDto } from '@/gacha/dto/gacha.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import { DEFAULT_PAGE } from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('gacha')
@Controller('gacha')
export class GachaController {
  constructor(private readonly gachaService: GachaService) {}

  @Post('roll')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Roll diário do gacha waifu (1/dia)' })
  roll(@Req() req: AuthenticatedRequest, @Body() dto: RollGachaDto) {
    return this.gachaService.roll(req.user.id, dto.turnstileToken);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Status do roll diário e pity' })
  status(@Req() req: AuthenticatedRequest) {
    return this.gachaService.status(req.user.id);
  }

  @Get('collection')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Coleção de cartas (própria ou pública)' })
  collection(
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.gachaService.collection(
      userId || req.user.id,
      req.user.id,
      parseInt(page ?? '1', 10) || DEFAULT_PAGE,
      parseInt(limit ?? '24', 10) || 24,
    );
  }

  @Get('recent')
  @ApiOperation({ summary: 'Últimos pulls visíveis do gacha' })
  recent(@Query('limit') limit: string) {
    return this.gachaService.recent(parseInt(limit ?? '20', 10) || 20);
  }

  @Get('ranking')
  @ApiOperation({ summary: 'Ranking de colecionadores por valor' })
  ranking(@Query('limit') limit: string) {
    return this.gachaService.ranking(parseInt(limit ?? '20', 10) || 20);
  }
}
