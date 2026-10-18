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
