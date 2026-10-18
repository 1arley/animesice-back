# Glossary

Domain terms and bounded concepts for `animesice-back`. Use these terms consistently across code, tests, and architecture reviews.

## Catalog & Episode Resolution

- **Episode Resolution (`EpisodeResolution`)**: The end-to-end Watchtower module (`src/watchtower/episode-resolution.service.ts`) responsible for turning an episode request `(animeId, slug, season, episodeNumber, audio)` into a verified, playable `Episode` record in PostgreSQL. It owns candidate discovery, extraction orchestration, media liveness validation (`probeMediaUrlDead`), `EpisodeSource` persistence, `NEW_EPISODE` notifications, and the `Anime.published` auto-unpublish/republish invariant.
- **Scrape Source (`ScrapeSource`)**: A per-provider adapter (`meusanimes`, `animesonline`, `topanimes`, `animesorion`, `animesdigital`) behind `src/embed/scrape/scrape-source.interface.ts`. Each adapter knows how to:
  1. Resolve candidate episode page URLs in 2 steps (`resolveEpisodeUrls`): slug template variants first, followed by parsing the static HTML episode listing on the provider's anime page.
  2. Extract raw video URLs (`.mp4`/`.m3u8`) or intermediate `playerTokens` (Blogger/YouTube/mirror embeds) via HTTP (`extractHttp`) or Playwright (`extract`).
- **Episode Source (`EpisodeSource`)**: A persisted mapping between a local `Episode` and a verified provider `pageUrl` + `sourceId` + `audio`. Used as the primary fast path before falling back to `ScrapeSource.resolveEpisodeUrls`.
- **Trusted Media Host (`TrustedMediaHosts`)**: Dynamic provenance-based allowlist (`src/common/trusted-media-hosts.ts`) of exact CDN hostnames extracted and probed by the scraper and persisted in `Episode.videoUrl`. Allows `/embed/media` to proxy dynamic per-episode CDNs without weakening SSRF protection.
- **Catalog Unpublish Invariant (`catalogUnpublished`)**: An anime is automatically unpublished (`published: false, catalogUnpublished: true`) when either:
  1. All of its persisted episodes lose working video sources (`videoBroken: true` or `videoUrl` empty), or
  2. Repeated catalog scans confirm the title is absent from external catalogs.
  Conversely, publishing or repairing at least one valid episode automatically republishes the anime (`published: true, catalogUnpublished: false, catalogAbsentChecks: 0`).
- **Rust Handoff (`rustFallbackUrl` / `rustFallbackSourceId`)**: When the out-of-process Rust Watchtower worker (`scraper-rust`) encounters a page that requires Chromium/Xvfb (`BROWSER_REQUIRED`), it marks `rustEligible: false` on the `WatchtowerJob` payload along with `rustFallbackUrl` and `rustFallbackSourceId` so the Node Watchtower worker can run targeted single-source browser extraction (`extractExact`).
- **Stream Resolution (`StreamingService`)**: The player-facing streaming module (`src/streaming/streaming.service.ts`) that resolves playable streams across synchronous (`/stream/source`), asynchronous lease-fenced job (`/stream/source/async`, `/stream/source/sse`, `StreamExtractionJob`), and mid-stream proxy recovery (`/stream/video`) paths. It owns single-flight coalescing (`scrapeInflight`), liveness verification, and unified persistence (`persistPlayerResolvedEpisode`: `Episode.videoUrl`, `EpisodeSource` upsert, `TrustedMediaHosts` registration, and `catalogUnpublished` auto-republish).

## Gacha & Economy

- **User Card (`UserCard`)**: A concrete copy of a catalog `GachaCard` owned by a user, carrying its own `edition`, `condition`, `foil`, `value`, `rankedValue`, and lifecycle `status` (`ACTIVE`, `ESCROW`, `BURNED`, `REMOVED`).
- **Trade-Up**: Consuming 4 `ACTIVE` `UserCard` copies of the same rarity (marking them `BURNED`) to mint 1 `UserCard` of the next higher rarity within a single atomic database transaction, weighted by the user's wishlist and input card attributes.
