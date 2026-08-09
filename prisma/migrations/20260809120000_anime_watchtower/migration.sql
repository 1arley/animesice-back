-- AlterTable
ALTER TABLE "Anime" ADD COLUMN "anilistId" INTEGER;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "Episode" ADD COLUMN "videoBroken" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Episode" ADD COLUMN "videoCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WatchtowerJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchtowerJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchtowerSourceHealth" (
    "sourceId" TEXT NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),

    CONSTRAINT "WatchtowerSourceHealth_pkey" PRIMARY KEY ("sourceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Anime_anilistId_key" ON "Anime"("anilistId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchtowerJob_type_dedupeKey_key" ON "WatchtowerJob"("type", "dedupeKey");

-- CreateIndex
CREATE INDEX "WatchtowerJob_status_nextRunAt_priority_idx" ON "WatchtowerJob"("status", "nextRunAt", "priority");

-- CreateIndex
CREATE INDEX "WatchtowerJob_type_status_idx" ON "WatchtowerJob"("type", "status");

-- CreateIndex
CREATE INDEX "WatchtowerSourceHealth_disabled_idx" ON "WatchtowerSourceHealth"("disabled");
