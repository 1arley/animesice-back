import {
  applyDecorators,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';

export function ApiGetUserMe() {
  return applyDecorators(
    UseGuards(JwtAuthGuard),
    ApiOperation({ summary: 'Obter perfil do usuário autenticado' }),
    HttpCode(HttpStatus.OK),
    ApiResponse({
      status: 200,
      description: 'Perfil do usuário obtido com sucesso',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string' },
        },
      },
    }),
    ApiBearerAuth(),
    ApiResponse({ status: 500, description: 'Erro desconhecido no servidor' }),
  );
}
