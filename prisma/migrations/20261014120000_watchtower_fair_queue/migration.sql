-- Let current releases, catalog discovery, and source backfill run before
-- the large historical repair backlog. This only reorders queued work.
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "repairQueuedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Episode_repairQueuedAt_idx" ON "Episode"("repairQueuedAt");

UPDATE "WatchtowerJob"
SET "priority" = 130, "updatedAt" = NOW()
WHERE "status" = 'PENDING'
  AND "type" = 'REPAIR_EPISODE'
  AND "priority" < 130;

UPDATE "WatchtowerJob"
SET "priority" = 110, "updatedAt" = NOW()
WHERE "status" = 'PENDING'
  AND "type" = 'SCAN_CATALOG'
  AND "priority" > 110;

UPDATE "WatchtowerJob" SET "priority" = 65, "updatedAt" = NOW()
WHERE "status" = 'PENDING' AND "type" = 'DISCOVER_SEASON';

UPDATE "WatchtowerJob" SET "priority" = 70, "updatedAt" = NOW()
WHERE "status" = 'PENDING' AND "type" = 'SYNC_AIRING';

UPDATE "WatchtowerJob" SET "priority" = 120, "updatedAt" = NOW()
WHERE "status" = 'PENDING' AND "type" = 'SYNC_SCHEDULES';

UPDATE "WatchtowerJob" SET "priority" = 180, "updatedAt" = NOW()
WHERE "status" = 'PENDING' AND "type" = 'BACKFILL_ANILIST';
