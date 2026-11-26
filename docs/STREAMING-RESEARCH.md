# Streaming research (23 November 2026)

Research is limited to public pages and ordinary unauthenticated HTTP requests. No challenge, CAPTCHA, access control, or media restriction was bypassed. URLs and temporary player tokens are intentionally omitted.

## AnimesOnlineCC

Observed pages:

- [Home](https://animesonlinecc.to/) and [episode index](https://animesonlinecc.to/episodio/) expose anime and episode links in server-rendered HTML. Episode URLs use `/episodio/<slug>-episodio-<number>/`; anime pages use `/anime/<slug>/` and list episodes by number.
- A sampled [episode page](https://animesonlinecc.to/episodio/dark-summoner-to-dekiteiru-episodio-8/) contains one iframe pointing at Blogger, an “HD” marker, and previous/all/next episode navigation. The initial HTML has no `<video>`, `<source>`, `.mp4`, or `.m3u8` media URL.
- The sample's iframe is sandboxed with scripts and same-origin allowed. This is consistent with an embedded Blogger player, but the fetchable page alone does not establish the implementation inside Blogger after JavaScript initialization. No claim is made about its codec, delivery protocol, bitrate ladder, seek behavior, subtitles, or recovery behavior.
- The sampled episode exposes one player iframe; “HD” is a quality label, not evidence of multiple independently selectable servers. Server counts and whether other episodes use other providers were not established.
- The homepage uses WordPress conventions and links to its public REST root. Initial HTML differs from the final player state by delegating playback to the iframe; post-initialization network requests were not inspected. A 403 from any follow-up request remains an unavailable sample.

This matches the current `AnimesonlineScrapeSource` approach: resolve episode URLs from page listings, collect Blogger tokens from episode HTML, and let the existing event-driven browser flow resolve tokens. The public sample does not justify a second adapter or bypass logic.

## bkp.mataroa.blog

At inspection, the root page was titled “MeusAnimes.Blog” but contained no anime entries, episode links, iframe, video element, or media URL. Its public `/rss/` feed was valid RSS with an empty channel and no items; `/robots.txt` and `/about/` returned 404. The response used `gunicorn` behind Caddy, unlike the WordPress response from `meusanimes.blog`. Mataroa documents that hosted blogs use `<username>.mataroa.blog` subdomains and that its platform supports RSS, so the hostname and RSS response are consistent with a Mataroa-hosted blog, not with the existing WordPress site.

The branding alone does not prove who controls the blog or that it is an official mirror. No canonical link, cross-domain link, matching post, public ownership statement, or authorization connecting it to `meusanimes.blog` was found. Its empty feed also gives no usable evidence of update cadence or stable episode identifiers.

**Classification: site without practical use for this project (currently).** Do not add it to production, scrape it as a source, or alias it to the MeusAnimes adapter. This decision can be revisited only with verifiable ownership/authorization and a populated, maintained catalog. The official Mataroa site describes the platform and subdomain model: [mataroa.blog](https://mataroa.blog/).

## Current request path and measured gaps

For `GET /stream/source`, the current path is:

1. Look up the anime, then the episode in Postgres.
2. Load verified `EpisodeSource` rows and check source health to build `availableSources`.
3. Separately, validate the stored media URL (including expiry/liveness) or run extraction and fallback.
4. Return the proxy URL; the browser then requests media through `/embed/media`.

Steps 2 and 3 were sequential despite being independent. They now run concurrently in `StreamingService.getSource`; the API still returns the same response and still waits for both, so it does not publish an unverified source early. When a stored URL is stale/missing, extraction and liveness probes remain on the critical path.

The scraper already has source health ranking, SWR/single-flight extraction caches, async extraction jobs/SSE, and an HTTP-first/Playwright fallback. The previous `scrapeEpisodeFromRankedSources` path called `resolveHealthRankedCandidates`, waiting for URL resolution across every healthy source before attempting playback; it now resolves, extracts, and probes one source at a time in health order and returns immediately on the first live media URL. This removes lower-priority source resolution from the successful path. It remains sequential on failures. A parallel first-playable race would need cancellation or bounded cleanup for losing browser/network work; it has not been added without measurements and cancellation support.

The media proxy uses a streaming Node `Readable`, forwards Range, preserves upstream `206` and relevant response headers, rewrites HLS playlists, and closes the pinned dispatcher when the body closes. It does not buffer successful video bodies. HLS playlist rewriting buffers the playlist itself, not its segments. Direct CDN delivery remains a future option only for origins the project is authorized to redistribute and can sign/control; the existing cost design describes that boundary.

## Baseline and instrumentation

There is no comparable production or end-to-end benchmark in this checkout. The current `MetricsService` reports five-minute cache counts and per-source extraction averages, but not request-stage percentiles, media TTFB, browser first-frame, rebuffer ratio, seek latency, bytes, or per-status probe outcomes. Scraper/stream debug logs now redact URL paths and query strings, but they still lack a shared request ID and structured stage durations. The live web inspection is a one-time source observation, not a playback benchmark. No p50/p95/p99 or before/after performance claim is inferred from it.

To establish a valid baseline, collect a fixed, authorized sample across warm URL, expired URL, cache hit/miss, source, and media type. Record monotonic stage durations for API lookup, source resolution, extraction, probe, and media first byte; record status classes and cache outcome without full URLs or query strings. Calculate p50/p95/p99 only after reporting sample counts. First frame, rebuffer ratio, and seek latency require frontend player telemetry and cannot be measured by this backend repository alone.

## Frontend contract for fallback and next-episode preparation

No frontend change is included. The existing contract remains:

- `GET /stream/source?anime=&episode=` returns `{ src, rawVideoUrl, embedUrl, reextracted, availableSources, selectedSourceId }`.
- Async resolution returns `202` with a `jobId`; the client follows the existing status/SSE flow and starts playback only after receiving a source.
- On media error, the frontend can request `refresh=1` or choose a verified `sourceId`, retain the current episode and `video.currentTime`, switch `src`, and restore the approximate position after `loadedmetadata`. The backend does not start a second playback or know the user's current playhead.
- There is no next-episode prewarm endpoint today. A future bounded endpoint should accept the next episode explicitly, be cancellable on navigation, and return metadata/source candidates only; it must not fetch media segments or bypass existing rate limits.

The API can report that source resolution failed, but first-frame/rebuffer/seek outcomes must be reported by the player if those metrics are required.
