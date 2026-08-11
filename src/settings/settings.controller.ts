import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import {
  UpdatePrivacyDto,
  UpdateNotificationPrefDto,
  UpdateSiteSettingsDto,
} from './dto/settings.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('settings')
@ApiBearerAuth('JWT-auth')
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // ── Personal settings: account ────────────────────────────────────────

  @Get('account')
  @ApiOperation({ summary: 'Configurações da conta do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Configurações da conta' })
  getAccountSettings(@Req() req: AuthenticatedRequest) {
    return this.settingsService.getAccountSettings(req.user.id);
  }

  @Post('account/change-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar troca de email' })
  requestEmailChange(
    @Req() req: AuthenticatedRequest,
    @Body() body: { newEmail: string; password: string },
  ) {
    return this.settingsService.changeEmail(
      req.user.id,
      body.newEmail,
      body.password,
    );
  }

  @Post('account/confirm-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar troca de email via token' })
  confirmEmailChange(@Body('token') token: string) {
    return this.settingsService.confirmEmailChange(token);
  }

  @Post('account/change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Alterar senha' })
  changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.settingsService.changePassword(
      req.user.id,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Patch('account/profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar nome e apelido' })
  updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() body: { name?: string; userName?: string },
  ) {
    return this.settingsService.updateProfile(
      req.user.id,
      body.name,
      body.userName,
    );
  }

  // ── Personal settings: privacy ────────────────────────────────────────

  @Get('privacy')
  @ApiOperation({ summary: 'Configurações de privacidade do usuário' })
  getPrivacySettings(@Req() req: AuthenticatedRequest) {
    return this.settingsService.getPrivacySettings(req.user.id);
  }

  @Patch('privacy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar configurações de privacidade' })
  updatePrivacySettings(
    @Req() req: AuthenticatedRequest,
    @Body() _dto: UpdatePrivacyDto,
  ) {
    return this.settingsService.getPrivacySettings(req.user.id);
  }

  // ── Personal settings: notifications ──────────────────────────────────

  @Get('notifications')
  @ApiOperation({ summary: 'Preferências de notificação do usuário' })
  getNotificationPreferences(@Req() req: AuthenticatedRequest) {
    return this.settingsService.getNotificationPreferences(req.user.id);
  }

  @Patch('notifications')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar preferência de notificação' })
  updateNotificationPreference(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateNotificationPrefDto,
  ) {
    return this.settingsService.updateNotificationPreference(
      req.user.id,
      dto.typeId,
      dto.channel,
      dto.enabled,
    );
  }

  // ── Site settings (ADMIN, SUPERADMIN) ─────────────────────────────────

  @Get('site')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Configurações globais do site' })
  getSiteSettings() {
    return this.settingsService.getSiteSettings();
  }

  @Patch('site')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar configurações globais do site' })
  updateSiteSettings(@Body() dto: UpdateSiteSettingsDto) {
    return this.settingsService.updateSiteSettings(dto);
  }

  // ── Admin settings: user management (ADMIN, SUPERADMIN) ──────────────

  @Get('admin/users')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Listar usuários (gerenciamento administrativo)' })
  listUsersForAdmin(
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.settingsService.listUsersForAdmin(
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get('admin/users/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({
    summary: 'Detalhes de usuário (gerenciamento administrativo)',
  })
  getUserDetailForAdmin(@Param('id') id: string) {
    return this.settingsService.getUserDetailForAdmin(id);
  }
}
