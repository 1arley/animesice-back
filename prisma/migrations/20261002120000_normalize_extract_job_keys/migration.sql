-- Normalize legacy extract:<animeId>:<episode> keys to the season-aware form.
-- CatalogScanner already writes season 1 for these legacy jobs.
UPDATE "WatchtowerJob" AS legacy
SET "status" = 'DONE',
    "dedupeKey" = legacy."dedupeKey" || ':legacy',
    "lockedBy" = NULL, "lockedAt" = NULL,
    "updatedAt" = NOW()
WHERE legacy."type" = 'EXTRACT_EPISODE'
  AND legacy."dedupeKey" ~ '^extract:[^:]+:[0-9]+$'
  AND EXISTS (
    SELECT 1
    FROM "WatchtowerJob" AS canonical
    WHERE canonical."type" = legacy."type"
      AND canonical."dedupeKey" =
        'extract:' || split_part(legacy."dedupeKey", ':', 2) || ':1:' ||
        split_part(legacy."dedupeKey", ':', 3)
  );

UPDATE "WatchtowerJob"
SET "dedupeKey" =
      'extract:' || split_part("dedupeKey", ':', 2) || ':1:' ||
      split_part("dedupeKey", ':', 3),
    "updatedAt" = NOW()
WHERE "type" = 'EXTRACT_EPISODE'
  AND "dedupeKey" ~ '^extract:[^:]+:[0-9]+$';
