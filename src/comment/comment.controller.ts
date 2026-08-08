import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CommentService } from '@/comment/comment.service';
import {
  CreateCommentDto,
  EditCommentDto,
} from '@/comment/dto/create-comment.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('comment')
@Controller('comment')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Post()
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Criar comentário' })
  @ApiResponse({ status: 201, description: 'Comentário criado' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Conta não verificada',
  })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCommentDto) {
    return this.commentService.create(req.user.id, dto);
  }

  @Get('anime/:animeId')
  @ApiOperation({ summary: 'Listar comentários de um anime' })
  @ApiResponse({ status: 200, description: 'Comentários retornados' })
  findByAnime(
    @Param('animeId') animeId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.commentService.findByAnime(
      animeId,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '50', 10) || 50,
    );
  }

  @Get('episode/:episodeId')
  @ApiOperation({ summary: 'Listar comentários de um episódio' })
  @ApiResponse({ status: 200, description: 'Comentários retornados' })
  findByEpisode(
    @Param('episodeId') episodeId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.commentService.findByEpisode(
      episodeId,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '50', 10) || 50,
    );
  }

  @Get(':id/replies')
  @ApiOperation({ summary: 'Listar respostas de um comentário (paginado)' })
  findByReplies(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.commentService.findReplies(
      id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '50', 10) || 50,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Editar comentário' })
  @ApiResponse({
    status: 403,
    description: 'Conta não verificada',
  })
  edit(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: EditCommentDto,
  ) {
    return this.commentService.edit(req.user.id, id, dto);
  }

  @Post(':id/like')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Curtir/descurtir comentário' })
  @ApiResponse({
    status: 403,
    description: 'Conta não verificada',
  })
  toggleLike(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.commentService.toggleLike(req.user.id, id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Deletar comentário' })
  @ApiResponse({ status: 200, description: 'Comentário deletado' })
  @ApiResponse({ status: 403, description: 'Sem permissão' })
  @ApiResponse({ status: 404, description: 'Comentário não encontrado' })
  @ApiResponse({
    status: 403,
    description: 'Conta não verificada',
  })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.commentService.remove(req.user.id, id);
  }
}
