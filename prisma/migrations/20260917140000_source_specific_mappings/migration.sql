-- Source-specific identities prevent AnimeSice slugs from leaking into external URLs.
CREATE TABLE "AnimeSource" (
    "id" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "externalKey" TEXT,
    "audio" "AudioType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnimeSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EpisodeSource" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "externalKey" TEXT,
    "audio" "AudioType" NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EpisodeSource_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WatchtowerSourceHealth"
ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT,
ADD COLUMN "lastFailureKind" TEXT,
ADD COLUMN "availabilityFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "contentMisses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "extractionFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "validationFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "capacityFailures" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "AnimeSource_animeId_sourceId_key" ON "AnimeSource"("animeId", "sourceId");
CREATE INDEX "AnimeSource_sourceId_externalKey_idx" ON "AnimeSource"("sourceId", "externalKey");
CREATE UNIQUE INDEX "EpisodeSource_episodeId_sourceId_key" ON "EpisodeSource"("episodeId", "sourceId");
CREATE INDEX "EpisodeSource_sourceId_externalKey_idx" ON "EpisodeSource"("sourceId", "externalKey");

ALTER TABLE "AnimeSource" ADD CONSTRAINT "AnimeSource_animeId_fkey"
FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EpisodeSource" ADD CONSTRAINT "EpisodeSource_episodeId_fkey"
FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
