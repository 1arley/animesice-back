CREATE TABLE "StreamExtractionJob" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "animeSlug" TEXT NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "videoUrl" TEXT,
    "playerEmbed" TEXT,
    "error" TEXT,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StreamExtractionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StreamExtractionJob_activeKey_key" ON "StreamExtractionJob"("activeKey");
CREATE INDEX "StreamExtractionJob_animeSlug_episodeNumber_season_status_idx" ON "StreamExtractionJob"("animeSlug", "episodeNumber", "season", "status");
CREATE INDEX "StreamExtractionJob_status_lockedUntil_idx" ON "StreamExtractionJob"("status", "lockedUntil");
