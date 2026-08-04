# Authentication

## Configuração (.env)

```env
JWT_ACCESS_SECRET=your-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=7d
```

## Proteger Rotas

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('protected')
@ApiBearerAuth()
export class ProtectedController {
  @Get()
  @UseGuards(JwtAuthGuard)
  getData(@Req() req) {
    return { userId: req.user.id };
  }
}
```

## Estrutura

- **Access Token**: Curto prazo (15min)
- **Refresh Token**: Longo prazo (7d), armazenado no banco
- **Senhas**: Bcrypt hash
