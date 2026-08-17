import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WatchHistoryService } from '@/watch-history/watch-history.service';
import { UpdateProgressDto } from '@/watch-history/dto/update-progress.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { DEFAULT_PAGE } from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('watch-history')
@Controller('watch-history')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WatchHistoryController {
  constructor(private readonly watchHistoryService: WatchHistoryService) {}

  @Post(':slug/:number')
  @ApiOperation({ summary: 'Atualizar progresso de visualização' })
  updateProgress(
    @Req() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() dto: UpdateProgressDto,
  ) {
    return this.watchHistoryService.updateProgress(
      req.user.id,
      slug,
      number,
      dto,
    );
  }

  @Get('continue')
  @ApiOperation({ summary: 'Lista "Continue assistindo"' })
  getContinueWatching(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit: string,
  ) {
    return this.watchHistoryService.getContinueWatching(
      req.user.id,
      parseInt(limit ?? '12', 10) || 12,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Histórico de visualização completo' })
  getHistory(
    @Req() req: AuthenticatedRequest,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.watchHistoryService.getHistory(
      req.user.id,
      parseInt(page ?? '1', 10) || DEFAULT_PAGE,
      parseInt(limit ?? '24', 10) || 24,
    );
  }

  @Delete(':slug/:number')
  @ApiOperation({ summary: 'Remover item do histórico de visualização' })
  deleteHistory(
    @Req() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Param('number', ParseIntPipe) number: number,
  ) {
    return this.watchHistoryService.deleteHistory(req.user.id, slug, number);
  }
}
