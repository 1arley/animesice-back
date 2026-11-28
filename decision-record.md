# Decision Record — Streaming Resolution & Async Job Persistence (`arch-streaming-20261018-r1`)

**Date:** 2026-10-18  
**Session ID:** `arch-streaming-20261018-r1`  
**Audit Log:** `.grill/arch-streaming-20261018-r1.jsonl`  
**Candidate:** #1 — Collapse streaming resolution and async job persistence (`StreamingService` + `ExtractionJobService` + `ScrapeService.reextractEpisodeVideo`)

## Settled Decisions

| ID | Title | Decision | Provenance | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Q1** | Module boundary: fold `ExtractionJobService` into `StreamingService` | Fold `ExtractionJobService` into `StreamingService` so `StreamingService` directly owns the `StreamExtractionJob` lease lifecycle, completion listeners, and single-flight extraction without a closure handoff seam. | `user` (after `jev` accept `0.71`, confidence `0.56`) | Eliminates the single-caller closure seam (`fn: () => Promise<...>`), removing redundant DB re-queries on job resumption and consolidating all stream resolution state behind one interface. |
| **Q2** | Unified persistence for async extraction jobs (`persistPlayerResolvedEpisode` + `trustMediaHosts`) | Always execute `persistPlayerResolvedEpisode` when a working `videoUrl` is resolved, and invoke `trustMediaHosts` in `buildSourceFromJobResult` when reading completed jobs. | `user` (after `jev` accept `0.56`, confidence `0.34`) | Ensures async extraction jobs register `TrustedMediaHosts` across replicas, upsert `EpisodeSource`, and enforce the `catalogUnpublished` auto-republish invariant without requiring a Prisma schema migration. |
| **Q3** | Unify mid-stream proxy recovery (`proxyVideo`) onto `doSingleScrape` and remove `ScrapeService.reextractEpisodeVideo` | Remove `ScrapeService.reextractEpisodeVideo` and route `proxyVideo` mid-stream recovery through `StreamingService`'s single-flight `doSingleScrape` and `persistPlayerResolvedEpisode`. | `jev` (accept `0.82`, confidence `0.73`) | Eliminates a duplicate partial-persistence path in `ScrapeService` so mid-stream 403/5xx recovery tries `embedUrl`, `EpisodeSource` rows, and ranked fallback sources with full persistence invariants. |
| **Q4** | Catalog visibility rule across `getSource` and `getSourceAsync` for `catalogUnpublished` titles | Allow `published: true` or `catalogUnpublished: true` in both `getSource` and `getSourceAsync`, while rejecting manually unpublished animes (`published: false, catalogUnpublished: false`) with 404. | `user` (after `jev` accept `0.68`, confidence `0.52`) | Aligns `getSource` and `getSourceAsync` lookup rules so auto-unpublished titles can self-heal on player demand while manually unpublished titles remain hidden. |
| **Q5** | Deduplicating URL unwrapping and `StreamSourceResponse` formatting in `StreamingService` | Consolidate URL unwrapping and `StreamSourceResponse` construction into private helpers inside `StreamingService` while keeping `StreamingController`'s interface contract intact. | `jev` (accept `0.95`, confidence `0.92`) | Removes duplicated `/embed/media?url=` unwrapping and YouTube/Blogger/media proxy URL formatting across sync and async paths without breaking controller routes or specs. |
| **Q6** | Lease-fenced persistence on async job completion (`finishJob`) | Return `{ videoUrl, playerEmbed, sourceId, pageUrl, audio }` from `doSingleScrape` and gate async job persistence on the `lockedBy` lease check in `finishJob` so expired workers are strictly fenced out before writing `Episode`, `EpisodeSource`, `TrustedMediaHosts`, or `Anime.published`. | `jev` (accept `0.81`, confidence `0.72`) | Preserves strict lease fencing when a slow worker's `lockedUntil` expires and another worker reclaims the job. |
| **Q7** | Unifying `reextractInflight` and `scrapeInflight` for `proxyVideo` recovery | Route `proxyVideo` recovery through the shared `scrapeInflight` single-flight map (invalidating `scrapeCache` on upstream 403/5xx) and remove the redundant `reextractInflight` map. | `user` (after `jev` accept `0.74`, confidence `0.61`, escalated on keyword `delete`) | Coalesces concurrent mid-stream 403 recoveries and player `getSource` calls into a single extraction per episode. |
| **Q8** | Republishing `catalogUnpublished` animes only after a live `videoUrl` probe (`persistPlayerResolvedEpisode`) | Require a verified live `rawVideoUrl` (via `persistPlayerResolvedEpisode`) before republishing a `catalogUnpublished: true` anime, and bypass `getSourceAsync`'s unprobed fast path whenever `anime.published === false`. | `user` (after `jev` amend `0.49`) | Prevents an unprobed stored URL or unverified embed from prematurely republishing an auto-unpublished anime. |

## Assumptions

- `StreamExtractionJob` schema in `prisma/schema.prisma` remains unchanged (no database migration needed).
- `StreamingController` public route contracts (`/stream/source`, `/stream/source/async`, `/stream/source/sse`, `/stream/token`, `/stream/video`) remain backward-compatible with the frontend.
- `GLOSSARY.md` will be updated to document `Stream Resolution` alongside `Episode Resolution`.

## Open Risks

- **Multi-replica `TrustedMediaHosts` registration:** When Replica A completes an async extraction job and Replica B serves `getJobStatus` or `buildSourceResponseFromJob`, Replica B must call `trustMediaHosts([job.result.videoUrl])` before returning the wrapped `/embed/media` URL so Replica B's SSRF proxy allowlist immediately trusts the host without waiting for the hourly DB refresh. (Mitigated by Q2).
- **Lease-fenced side effects:** `doSingleScrape` must not write to `Episode`, `EpisodeSource`, or `Anime` before `finishJob` confirms `updateMany({ where: { id, status: 'processing', lockedBy: lockId } }).count > 0` on the async job path. (Mitigated by Q6).

---

# Decision Record — Ampulheta do Éter (`gacha-ampulheta-eter-20261128`)

**Date:** 2026-11-28

## Settled Decisions

- **Catálogo sem `ITEM_KINDS`:** `AMPULHETA_ETER` entra em `ITEM_CATALOG` (`field: 'ampulhetaEter'` em `GachaInventory`), herdando `creditItems`/`reserveItems`, proteção contra overflow e escrows/trocas. Não entra em `ITEM_KINDS` porque esse enum representa itens de melhoria/forja/loja de pedras e proteção.
- **Drop apenas no `claim()`:** A chance (`ampulheta_drop_chance`, default `0.5%`, range `0–100`, controlada por `ampulheta_enabled`, default `true`) é sorteada dentro da transação de `GachaService.claim()` após a trava de idempotência (`gachaSpin.updateMany` com `claimedAt: null`). Sortear no `spin()` (preview) permitiria farm grátis por usuários que não resgatam a carta.
- **Uso atômico e idempotente (`POST /gacha/economy/ampulheta/use`):** Executa via `runOperation(..., 'USE_AMPULHETA', ...)` com `lockItemInventory` (`FOR UPDATE`), exige `GachaClaimLock` ativo (`lockedUntil > now`), decrementa `ampulhetaEter >= 1` e remove o lock com `deleteMany({ where: { userId, lockedUntil: { gt: now } } })` (lançando erro para rollback se nenhuma linha for removida).
- **Bloqueio durante evento de resgate ativo (`claim_event`):** Assim como o bypass pago (`bypassPriceCents`), o uso da Ampulheta do Éter é bloqueado enquanto `claimEventState().active === true`, pois o evento já reduz o cooldown global para 1h e altera a economia da coleta.
- **Configuração dinâmica:** `ampulheta_drop_chance` e `ampulheta_enabled` ficam em `GachaConfig` (fonte de verdade, lida pelo cache do `GachaConfigService`), com validação no `GachaConfigService` (`assertChancePercent` / `assertBooleanConfig`). Elas **não** entram em `ECONOMY_DEFAULTS`: como `spin_shard_chance`, são chaves standalone apenas espelhadas no snapshot econômico ativo via `STANDALONE_ECONOMY_KEYS`, e nenhum consumidor as lê do snapshot.
- **`assertEconomyEnabled` no uso:** `useAmpulheta` chama `assertEconomyEnabled` antes de `lockItemInventory`, como todo consumível de `runOperation` (`useItem`, `craftItem`, `convertItem`, `buyItem`). Conta com saldo negativo ou `gachaMarketBlockedAt` (revisão) não consegue converter o item em vantagem de claim; usuários fora de `economy_rollout_percent` recebem 403.
- **Drop nunca derruba o resgate:** o `creditItems` da Ampulheta dentro de `claim()` é best-effort. Se o inventário estiver no teto (`MAX_INT`), o 409 de `creditItems` é convertido em “sem drop” (log de warning) em vez de abortar a transação — o jogador perde o bônus, não a carta. O `updateMany` condicional retorna `count: 0` sem gerar erro de Postgres, então a transação segue válida para o resto do claim.
- **Descoberta pelo front:** `GET /gacha/status` passou a devolver `ampulhetaCount`, para a tela de claim decidir entre o bypass pago (`bypassPriceCents`) e a Ampulheta sem uma segunda chamada a `/gacha/economy/inventory`.
- **Limite econômico:** o ganho de cadência fica limitado por `spins_per_hour` (5/h): sem preview não há claim, então a Ampulheta troca o cooldown pela cota de giros, e não cria faucet ilimitado de cristais.
