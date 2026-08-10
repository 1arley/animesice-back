import {
  Controller,
  Get,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { AuditService } from '@/common/services/audit.service';
import { Audit } from '@/auth/decorators/audit.decorator';

@ApiTags('admin')
@Controller('admin/audit')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('sensitive-access')
  @UseGuards(RolesGuard)
  @Roles('SUPERADMIN')
  @Audit('VIEW_AUDIT_LOGS', 'AdminAuditLog')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ver logs de acesso a dados sensíveis (últimos 7 dias)',
  })
  @ApiResponse({
    status: 200,
    description: 'Logs de auditoria retornados',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          action: { type: 'string' },
          resourceType: { type: 'string' },
          admin: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              role: { type: 'string' },
            },
          },
          ipAddress: { type: 'string' },
          createdAt: { type: 'string' },
        },
      },
    },
  })
  async getSensitiveDataAccess(
    @Query('resourceType') resourceType: string = 'User',
    @Query('days') days: string = '7',
  ) {
    const daysNum = Math.min(parseInt(days) || 7, 90); // Máximo 90 dias
    return this.auditService.getSensitiveDataAccess(resourceType, daysNum);
  }
}
