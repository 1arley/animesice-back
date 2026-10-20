-- Cristais por tempo assistido: rastro por usuário+episódio (drip + bônus completo)
CREATE TABLE "WatchReward" (
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "paidSeconds" INTEGER NOT NULL DEFAULT 0,
    "credited" INTEGER NOT NULL DEFAULT 0,
    "completedRewarded" BOOLEAN NOT NULL DEFAULT false,
    "lastProgress" INTEGER NOT NULL DEFAULT 0,
    "lastAt" TIMESTAMPTZ(6),

    CONSTRAINT "WatchReward_pkey" PRIMARY KEY ("userId","episodeId")
);

ALTER TABLE "WatchReward" ADD CONSTRAINT "WatchReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchReward" ADD CONSTRAINT "WatchReward_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "CrystalEventType" ADD VALUE 'WATCH';
