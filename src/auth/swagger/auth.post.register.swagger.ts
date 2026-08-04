import { applyDecorators, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

export function ApiRegisterUser() {
  return applyDecorators(
    ApiOperation({ summary: 'Registrar novo usuário' }),
    HttpCode(HttpStatus.CREATED),
    ApiBearerAuth('JWT-auth'),
    ApiResponse({
      status: 201,
      description: 'Usuário cadastrado com sucesso',
      schema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            example: 'Usuário cadastrado com sucesso.',
          },
          user: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                example: '123e4567-e89b-12d3-a456-426614174000',
              },
              name: { type: 'string', example: 'João Silva' },
              email: { type: 'string', example: 'joao@animesice.com' },
              role: { type: 'string', example: 'USER' },
              createdAt: {
                type: 'string',
                example: '2025-10-24T10:00:00.000Z',
              },
              updatedAt: {
                type: 'string',
                example: '2025-10-24T10:00:00.000Z',
              },
            },
          },
        },
      },
    }),
    ApiResponse({ status: 409, description: 'Email já cadastrado' }),
    ApiResponse({ status: 500, description: 'Erro desconhecido no servidor' }),
  );
}
