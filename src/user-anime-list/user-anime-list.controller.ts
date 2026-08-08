import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserAnimeListService } from '@/user-anime-list/user-anime-list.service';
import { UpdateUserAnimeListDto } from '@/user-anime-list/dto/update-user-anime-list.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('user-anime-list')
@ApiBearerAuth('JWT-auth')
@Controller('user-anime-list')
@UseGuards(JwtAuthGuard)
export class UserAnimeListController {
  constructor(private readonly userAnimeListService: UserAnimeListService) {}

  @Post(':slug')
  @ApiOperation({ summary: 'Adicionar ou atualizar anime na lista pessoal' })
  upsert(
    @Req() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Body() dto: UpdateUserAnimeListDto,
  ) {
    return this.userAnimeListService.upsert(req.user.id, slug, dto);
  }

  @Delete(':slug')
  @ApiOperation({ summary: 'Remover anime da lista pessoal' })
  remove(@Req() req: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.userAnimeListService.remove(req.user.id, slug);
  }

  @Get()
  @ApiOperation({ summary: 'Listar animes da lista pessoal' })
  list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status?: string,
  ) {
    return this.userAnimeListService.list(req.user.id, page, limit, status);
  }

  @Get(':slug/check')
  @ApiOperation({ summary: 'Verificar se anime está na lista' })
  check(@Req() req: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.userAnimeListService.check(req.user.id, slug);
  }
}
