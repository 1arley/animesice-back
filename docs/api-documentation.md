# API Documentation (Swagger)

## Estrutura

Documentação separada do controller via decorators customizados:

```
src/
└── user/
    ├── user.controller.ts
    └── swagger/
        └── user.post.swagger.ts
```

## Criar Decorator

```typescript
// swagger/user.post.swagger.ts
import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

export function CreateUserSwagger() {
  return applyDecorators(
    ApiOperation({ summary: 'Criar usuário' }),
    ApiResponse({ status: 201, description: 'Criado com sucesso' }),
    ApiResponse({ status: 400, description: 'Erro de validação' }),
    ApiBearerAuth(),
  );
}
```

## Usar no Controller

```typescript
@ApiTags('user')
@Controller('user')
export class UserController {
  @Post()
  @CreateUserSwagger()
  create(@Body() dto: CreateUserDto) {}
}
```

## DTOs

Anotar campos com `@ApiProperty()`:

```typescript
export class CreateUserDto {
  @ApiProperty({ example: 'João Silva' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'email@exemplo.com' })
  @IsEmail()
  email: string;
}
```

Swagger UI: `http://localhost:3000/api/docs`
