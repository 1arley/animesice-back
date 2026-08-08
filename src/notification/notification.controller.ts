import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationService } from '@/notification/notification.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { DEFAULT_PAGE } from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import { NotificationType, NotificationChannel } from '@prisma/client';

@ApiTags('notification')
@Controller('notification')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Listar notificações do usuário' })
  list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('unread') unread: string,
  ) {
    return this.notificationService.list(
      req.user.id,
      parseInt(page ?? '1', 10) || DEFAULT_PAGE,
      parseInt(limit ?? '20', 10) || 20,
      unread === 'true',
    );
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar notificação como lida' })
  markAsRead(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.notificationService.markAsRead(req.user.id, id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marcar todas notificações como lidas' })
  markAllAsRead(@Req() req: AuthenticatedRequest) {
    return this.notificationService.markAllAsRead(req.user.id);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Listar preferências de notificação' })
  getPreferences(@Req() req: AuthenticatedRequest) {
    return this.notificationService.getPreferences(req.user.id);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Atualizar preferência de notificação' })
  updatePreference(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      typeId: NotificationType;
      channel: NotificationChannel;
      enabled: boolean;
    },
  ) {
    return this.notificationService.updatePreference(
      req.user.id,
      body.typeId,
      body.channel,
      body.enabled,
    );
  }
}
