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

## Busca (Fuzzy / pg_trgm)

| Variável                | Default  | Descrição                                                                 |
| ----------------------- | -------- | ------------------------------------------------------------------------- |
| `SEARCH_FUZZY_THRESHOLD` | `0.35`   | Limiar de word_similarity (0–1) p/ entrar no ranking fuzzy; menor = mais recall, mais ruído. Migration: `prisma/migrations/20260812120000_add_fuzzy_search`. |

## Métricas / Observabilidade

| Variável        | Default | Descrição                                                                 |
| --------------- | ------- | ------------------------------------------------------------------------- |
| `METRICS_TOKEN` | —       | Token p/ GET `/api/metrics` (header `X-Metrics-Token`). Sem valor, o endpoint fica desabilitado (404). |
