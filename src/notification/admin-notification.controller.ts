import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminNotificationCategory } from '@prisma/client';
import { AdminNotificationService } from '@/notification/admin-notification.service';
import { SendAdminNotificationDto } from '@/notification/dto/send-admin-notification.dto';
import { AuditService } from '@/common/services/audit.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('admin-notification')
@ApiBearerAuth('JWT-auth')
@Controller('admin/notification')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
export class AdminNotificationController {
  constructor(
    private readonly adminNotificationService: AdminNotificationService,
    private readonly auditService: AuditService,
  ) {}

  @Get('recipients')
  @ApiOperation({
    summary: 'Buscar jogadores por nome, @usuário, e-mail ou id (admin)',
  })
  searchRecipients(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminNotificationService.searchRecipients(
      search,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get('audience')
  @ApiOperation({ summary: 'Contagem estimada de todos os jogadores (admin)' })
  countGlobalAudience() {
    return this.adminNotificationService.countGlobalAudience();
  }

  @Get('history')
  @ApiOperation({ summary: 'Histórico de comunicados enviados (admin)' })
  listHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: AdminNotificationCategory,
    @Query('search') search?: string,
  ) {
    return this.adminNotificationService.listHistory(
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
      { category, search },
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalhes de um comunicado e seus destinatários (admin)',
  })
  getCampaign(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminNotificationService.getCampaign(
      id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Post('send')
  @ApiOperation({
    summary: 'Enviar notificação individual, para um grupo ou global',
  })
  async send(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SendAdminNotificationDto,
  ) {
    try {
      const result = await this.adminNotificationService.send(req.user.id, dto);
      await this.auditService.logRequest(
        req.user.id,
        'SEND_NOTIFICATION',
        'AdminNotification',
        req,
        result.id,
        result.recipientCount,
      );
      return result;
    } catch (error) {
      await this.auditService.logError(
        req.user.id,
        'SEND_NOTIFICATION',
        'AdminNotification',
        req,
        error as Error,
      );
      throw error;
    }
  }
}
