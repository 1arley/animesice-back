DELETE FROM "EpisodeSource" WHERE "sourceId" = 'tioanime';
DELETE FROM "AnimeSource" WHERE "sourceId" = 'tioanime';

UPDATE "Episode"
SET "sourceId" = NULL,
    "videoBroken" = true,
    "videoCheckedAt" = NULL,
    "updatedAt" = NOW()
WHERE "sourceId" = 'tioanime';
