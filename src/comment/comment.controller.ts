import {
  Controller,
  Get,
  Post,
  Delete,
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
import { CommentService } from '@/comment/comment.service';
import { CreateCommentDto } from '@/comment/dto/create-comment.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('comment')
@Controller('comment')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Criar comentário' })
  @ApiResponse({ status: 201, description: 'Comentário criado' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCommentDto) {
    return this.commentService.create(req.user.id, dto);
  }

  @Get('anime/:animeId')
  @ApiOperation({ summary: 'Listar comentários de um anime' })
  @ApiResponse({ status: 200, description: 'Comentários retornados' })
  findByAnime(@Param('animeId') animeId: string) {
    return this.commentService.findByAnime(animeId);
  }

  @Get('episode/:episodeId')
  @ApiOperation({ summary: 'Listar comentários de um episódio' })
  @ApiResponse({ status: 200, description: 'Comentários retornados' })
  findByEpisode(@Param('episodeId') episodeId: string) {
    return this.commentService.findByEpisode(episodeId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Deletar comentário' })
  @ApiResponse({ status: 200, description: 'Comentário deletado' })
  @ApiResponse({ status: 403, description: 'Sem permissão' })
  @ApiResponse({ status: 404, description: 'Comentário não encontrado' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.commentService.remove(req.user.id, id);
  }
}
