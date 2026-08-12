import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SocialService } from '@/social/social.service';
import { CreatePostCommentDto, CreatePostDto } from '@/social/dto/social.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '@/auth/optional-jwt-auth.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import type { Request } from 'express';

/** Request que pode (ou não) ter usuário — rotas com OptionalJwtAuthGuard. */
type OptionalAuthRequest = Request & { user?: AuthenticatedRequest['user'] };

@ApiTags('social')
@Controller('social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  // --- Posts ---

  @Post('posts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Criar post no feed da comunidade' })
  createPost(@Req() req: AuthenticatedRequest, @Body() dto: CreatePostDto) {
    return this.socialService.createPost(req.user.id, dto);
  }

  @Get('feed')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Feed social (posts + atividade), scope=global (padrão) ou following (exige login)',
  })
  getFeed(
    @Req() req: OptionalAuthRequest,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('scope') scope: string,
  ) {
    return this.socialService.getFeed(
      req.user?.id ?? null,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
      scope === 'following' ? 'following' : 'global',
    );
  }

  @Get('posts/:id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Detalhe de um post' })
  getPost(@Req() req: OptionalAuthRequest, @Param('id') id: string) {
    return this.socialService.getPost(id, req.user?.id ?? null);
  }

  @Delete('posts/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Excluir o próprio post' })
  deletePost(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.socialService.deletePost(req.user.id, id);
  }

  @Post('posts/:id/like')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Curtir/descurtir post (toggle)' })
  togglePostLike(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.socialService.togglePostLike(req.user.id, id);
  }

  @Get('posts/:id/comments')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Comentários de um post' })
  getPostComments(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.socialService.getPostComments(
      id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Post('posts/:id/comments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Comentar em um post' })
  createPostComment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreatePostCommentDto,
  ) {
    return this.socialService.createPostComment(req.user.id, id, dto);
  }

  @Post('posts/:id/share')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Contabilizar compartilhamento de um post' })
  sharePost(@Req() _req: AuthenticatedRequest, @Param('id') id: string) {
    return this.socialService.sharePost(id);
  }

  // --- Follow ---

  @Post('follow/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Seguir/deixar de seguir usuário (toggle)' })
  toggleFollow(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    return this.socialService.toggleFollow(req.user.id, userId);
  }

  @Get('follow/check/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verificar se já sigo o usuário' })
  checkFollow(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    return this.socialService.checkFollow(req.user.id, userId);
  }

  @Get('following')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Lista de usuários que eu sigo' })
  getFollowing(
    @Req() req: AuthenticatedRequest,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.socialService.getFollowing(
      req.user.id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get('following/:userId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Quem um usuário segue (lista pública do perfil)' })
  getFollowingForUser(
    @Req() req: OptionalAuthRequest,
    @Param('userId') userId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.socialService.getFollowingForUser(
      userId,
      req.user?.id ?? null,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get('followers/:userId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Seguidores de um usuário' })
  getFollowers(
    @Req() req: OptionalAuthRequest,
    @Param('userId') userId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.socialService.getFollowers(
      userId,
      req.user?.id ?? null,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }
}
