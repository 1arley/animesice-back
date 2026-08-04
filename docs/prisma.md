# Prisma ORM

## Schema

- **PostgreSQL**: `prisma/schema.prisma` (produção)
- **SQLite**: `prisma/schema.test.prisma` (testes)

## Variáveis de Ambiente

```env
DATABASE_URL="postgresql://user:password@localhost:5432/db"
DATABASE_TEST_URL="file:./dev.db"
```

## Comandos

| Comando                  | Descrição           |
| ------------------------ | ------------------- |
| `npm run generate`       | Gera cliente Prisma |
| `npm run prisma:migrate` | Executa migrações   |
| `npm run prisma:studio`  | Interface visual    |
| `npm run seed`           | Popula banco        |

## Modelos

- **User**: id, email, password, name, role, createdAt, updatedAt
- **RefreshToken**: id, token, userId, expiresAt

Ver `schema.dbml` para diagrama.
