import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';

export function ApiRefreshTokens() {
  return applyDecorators(
    ApiOperation({ summary: 'Renovar tokens' }),
    ApiBearerAuth('JWT-auth'),
    ApiResponse({
      status: 201,
      description: 'Tokens renovados com sucesso',
      schema: {
        type: 'object',
        properties: {
          access_token: { type: 'string', example: 'eyJ...' },
          refresh_token: { type: 'string', example: 'eyJ...' },
        },
      },
    }),
    ApiResponse({
      status: 401,
      description: 'Refresh token inválido ou expirado',
    }),
    ApiResponse({ status: 500, description: 'Erro desconhecido no servidor' }),
  );
}
