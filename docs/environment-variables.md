# Environment Variables

## Arquivos

| Arquivo             | Descrição              | Git       |
| ------------------- | ---------------------- | --------- |
| `.env`              | Configuração local     | Ignorado  |
| `.env.test`         | Testes locais          | Commitado |
| `.env.staging`      | Staging                | Ignorado  |
| `.env.prod`         | Produção               | Ignorado  |

## Setup

```bash
cp .env.example .env
```

## Uso

```typescript
// Via process.env
const port = process.env.PORT ?? 3000;

// Via ConfigService
constructor(private configService: ConfigService) {}
getPort() { return this.configService.get('PORT'); }
```

## ConfigModule

```typescript
ConfigModule.forRoot({
  envFilePath: ['.env', '.env.local'],
  isGlobal: true,
});
```

## Scraping / Embed (Provider Orchestration)

| Variável                | Default       | Descrição                                                                  |
| ----------------------- | ------------- | -------------------------------------------------------------------------- |
| `SCRAPE_CACHE_TTL_MS`   | `600000`      | TTL do cache fresco de resultados de scrape (por source + URL do episódio) |
| `SCRAPE_CACHE_STALE_MS` | `3600000`     | Janela stale-while-revalidate: serve stale e revalida em background        |
