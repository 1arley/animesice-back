-- Esta migration deve ser executada sem BEGIN/COMMIT: PostgreSQL não permite
-- CREATE INDEX CONCURRENTLY dentro de uma transação. IF NOT EXISTS consulta o
-- catálogo antes de cada criação e torna reaplicações seguras.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Episode_animeId_number_season_idx"
  ON "Episode" ("animeId", "number", "season");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "WatchHistory_userId_completed_watchedAt_idx"
  ON "WatchHistory" ("userId", "completed", "watchedAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserAnimeList_animeId_status_idx"
  ON "UserAnimeList" ("animeId", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_userId_read_createdAt_idx"
  ON "Notification" ("userId", "read", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PostComment_postId_status_createdAt_idx"
  ON "PostComment" ("postId", "status", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Anime_published_createdAt_idx"
  ON "Anime" ("published", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Anime_published_rating_idx"
  ON "Anime" ("published", "rating" DESC);
