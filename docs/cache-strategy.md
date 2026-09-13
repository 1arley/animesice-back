# Estratégia de cache (pendente de Redis)

> **Atualizado 2026-09-12:** por causa do estouro de egress do plano free, foi
> adotado **cache local TTL curto** (120s) nas rotas públicas de catálogo
> (`CatalogCacheInterceptor`), o que a nota original abaixo vetava. Isso vale só
> para o **catálogo público** (monorreplica na VPS, sem dado por usuário, frescor
> ≤2 min acordado). O plano de Redis/invalidação por evento abaixo continua o alvo
> para quando a consistência de frescor pesar mais que o egress. Ver
> [`docs/adr/0001-supabase-metadata-only-egress.md`](./adr/0001-supabase-metadata-only-egress.md).

O projeto não possui Redis, cliente compatível nem módulo de cache configurado.
Por isso as rotas **que não estão no cache TTL local** acima seguem sem cache, que
ficaria inconsistente entre réplicas. Quando Redis estiver disponível, os pontos
recomendados são:

| Recurso    | Chave sugerida                  | TTL    | Invalidação                                 |
| ---------- | ------------------------------- | ------ | ------------------------------------------- |
| Catálogo   | `catalog:v1:<hash-dos-filtros>` | 5 min  | publicação/edição de anime                  |
| Detalhes   | `anime:v1:<slug>`               | 10 min | anime, episódio, rating ou gênero alterado  |
| Gêneros    | `genres:v1`                     | 1 h    | criação/edição de gênero                    |
| Calendário | `schedule:v1:<timezone>`        | 5 min  | `ScheduleSync` concluído                    |
| Rankings   | `rankings:v1:<tipo>:<janela>`   | 10 min | aceitar TTL; invalidação por evento em lote |

Usar cache-aside, JSON versionado, TTL com jitter de até 10% e coalescência de
misses (lock curto com `SET NX PX`) para evitar stampede. Nunca armazenar dados
privados de usuário nessas chaves públicas. Métricas mínimas: hit ratio, latência,
erros e idade do valor servido.
