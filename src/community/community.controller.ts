import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommunityService } from '@/community/community.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import {
  CreateAnimeRequestDto,
  CreateSiteFeedbackDto,
} from '@/community/dto/community.dto';
import { FeedbackStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('community')
@Controller()
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  // --- Anime requests (public read, auth write) ---

  @Get('anime-requests')
  @ApiOperation({ summary: 'Listar pedidos de anime' })
  listRequests(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
  ) {
    return this.communityService.listRequests(
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
      status,
    );
  }

  @Post('anime-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Criar pedido de anime' })
  createRequest(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateAnimeRequestDto,
  ) {
    return this.communityService.createRequest(req.user.id, dto);
  }

  @Post('anime-requests/:id/vote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Votar em pedido de anime' })
  voteRequest(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.communityService.voteRequest(id, req.user.id);
  }

  @Patch('admin/anime-requests/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Atualizar status de pedido de anime (admin)' })
  adminUpdateRequest(
    @Param('id') id: string,
    @Body() body: { status: FeedbackStatus; adminNote?: string },
  ) {
    return this.communityService.adminUpdateRequestStatus(
      id,
      body.status,
      body.adminNote,
    );
  }

  // --- Site feedback ---

  @Get('feedback')
  @ApiOperation({ summary: 'Listar feedbacks do site' })
  listFeedback(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('type') type: string,
    @Query('status') status: string,
  ) {
    return this.communityService.listFeedback(
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
      type,
      status,
    );
  }

  @Post('feedback')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Criar feedback (sugestão/bug)' })
  createFeedback(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSiteFeedbackDto,
  ) {
    return this.communityService.createFeedback(req.user.id, dto);
  }

  @Post('feedback/:id/upvote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Upvote em feedback' })
  upvoteFeedback(@Param('id') id: string) {
    return this.communityService.upvoteFeedback(id);
  }

  @Patch('admin/feedback/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Atualizar status de feedback (admin)' })
  adminUpdateFeedback(
    @Param('id') id: string,
    @Body() body: { status: FeedbackStatus; adminNote?: string },
  ) {
    return this.communityService.adminUpdateFeedbackStatus(
      id,
      body.status,
      body.adminNote,
    );
  }
}
