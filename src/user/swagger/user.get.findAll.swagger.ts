import {
  applyDecorators,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';

export function ApiFindAllUsers() {
  return applyDecorators(
    UseGuards(JwtAuthGuard, RolesGuard),
    ApiBearerAuth(),
    ApiOperation({ summary: 'Listar todos os usuários (Apenas ADMIN)' }),
    HttpCode(HttpStatus.OK),
    ApiResponse({
      status: 200,
      description: 'Lista de usuários retornada com sucesso',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              example: '123e4567-e89b-12d3-a456-426614174000',
            },
            name: { type: 'string', example: 'João Silva' },
            email: { type: 'string', example: 'joao@animesice.com' },
            createdAt: { type: 'string', example: '2025-10-24T10:00:00.000Z' },
            updatedAt: { type: 'string', example: '2025-10-24T10:00:00.000Z' },
          },
        },
      },
    }),
    ApiResponse({ status: 401, description: 'Não autenticado' }),
    ApiResponse({ status: 403, description: 'Sem permissão (apenas ADMIN)' }),
    ApiResponse({ status: 500, description: 'Erro desconhecido no servidor' }),
  );
}
