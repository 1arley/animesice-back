# Docker

## Comandos

| Script                   | Descrição                |
| ------------------------ | ------------------------ |
| `npm run docker:up`      | Inicia containers        |
| `npm run docker:down`    | Para containers          |
| `npm run docker:build`   | Compila imagem           |
| `npm run docker:rebuild` | Limpa e rebuilda         |
| `npm run docker:logs`    | Logs da aplicação        |
| `npm run docker:test`    | Executa testes           |
| `npm run docker:pgadmin` | Inicia pgAdmin (`:5050`) |

## Configuração

```env
PORT=3000
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=animesice_db
```

> Dentro do Docker, use o nome do serviço (`postgres`) ao invés de `localhost`.

## Volumes

- `postgres_data`: Dados do banco (persistente)

```bash
# Reset completo
npm run docker:clean && npm run docker:up
docker compose exec app npx prisma migrate deploy
```

## Endpoints

- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs
- pgAdmin: http://localhost:5050
