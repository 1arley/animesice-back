# Deploy

## Variáveis de ambiente

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/animesice_db?schema=public
JWT_ACCESS_SECRET=<trocar>
JWT_REFRESH_SECRET=<trocar>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
API_PREFIX=api
SWAGGER_PATH=api/docs
CORS_ORIGIN=https://seu-frontend.com
CORS_CREDENTIALS=true
# Supabase (opcional, só p/ upload manual)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET=
```

## Backend

```bash
npm install
npx prisma migrate deploy
npm run build
NODE_ENV=production npm run start:prod   # node dist/main
```

Ou Docker:

```bash
npm run docker:up          # docker compose up -d
docker compose exec app npx prisma migrate deploy
```

## Frontend

```bash
cd ../animesice-web
npm install
echo "NEXT_PUBLIC_API_URL=https://api.seu-dominio.com/api" > .env.local
npm run build
npm start                   # next start (PORT=3000)
```

## Pré-requisites

- PostgreSQL acessível (Docker ou externo).
- IP de saída do backend **igual** ao IP que extrai os tokens da CDN (proxy de mídia resolve isso — vídeos freamados pelo backend, não pelo browser).
- Backend com acesso outbound a `animefire.io` (re-extração HTTP).
- Playwright chrome instalado se usar fontes não-animefire (`npx playwright install chromium`).

## Caveats

- **IP-vínculo**: tokens `.mp4` da `lightspeedst.net` vinculam ao IP. O proxy `/embed/media` consome pelo IP do backend — funciona mesmo em prod com user remoto.
- **Sem armazenamento local de vídeo**: tudo é proxy stream sob demanda. DB guarda só URLs.
- **CORS**: `CORS_ORIGIN` deve listar a URL do frontend em prod.
