import {
  Controller,
  Post,
  Get,
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
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { ModerationService } from '@/moderation/moderation.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import {
  CreateReportDto,
  ResolveReportDto,
  ModerateUserDto,
} from '@/moderation/dto/moderation.dto';
import { ReportStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('moderation')
@ApiBearerAuth('JWT-auth')
@Controller()
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  // --- Public report endpoint (any authenticated user) ---
  @Post('report')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Denunciar conteúdo ou usuário' })
  @ApiResponse({ status: 201, description: 'Denúncia criada' })
  createReport(@Req() req: AuthenticatedRequest, @Body() dto: CreateReportDto) {
    return this.moderationService.createReport(req.user.id, dto);
  }

  // --- Admin endpoints ---
  @Get('admin/reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Listar denúncias (admin)' })
  listReports(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status?: string,
  ) {
    return this.moderationService.listReports(
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
      status,
    );
  }

  @Patch('admin/reports/:id/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Resolver denúncia como RESOLVED' })
  resolveReport(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.moderationService.resolveReport(
      id,
      req.user.id,
      ReportStatus.RESOLVED,
      dto,
    );
  }

  @Patch('admin/reports/:id/dismiss')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Rejeitar denúncia como DISMISSED' })
  dismissReport(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.moderationService.resolveReport(
      id,
      req.user.id,
      ReportStatus.DISMISSED,
      dto,
    );
  }

  @Post('admin/users/:id/moderate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({
    summary: 'Aplicar ação de moderação a usuário (warn/mute/ban)',
  })
  moderateUser(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ModerateUserDto,
  ) {
    return this.moderationService.moderateUser(id, req.user.id, dto);
  }

  @Delete('admin/comments/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Ocultar comentário (moderação)' })
  deleteComment(@Param('id') id: string) {
    return this.moderationService.deleteComment(id, '');
  }
}
