-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('PLANNING', 'WATCHING', 'COMPLETED', 'ON_HOLD', 'DROPPED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_EPISODE', 'COMMENT_REPLY', 'COMMENT_LIKE', 'MODERATION_ACTION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateTable
CREATE TABLE "UserAnimeList" (
    "userId" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "status" "WatchStatus" NOT NULL DEFAULT 'PLANNING',
    "episodesWatched" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "notes" TEXT,
    "rewatchCount" INTEGER NOT NULL DEFAULT 0,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAnimeList_pkey" PRIMARY KEY ("userId","animeId")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "typeId" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAnimeList_animeId_idx" ON "UserAnimeList"("animeId");

-- CreateIndex
CREATE INDEX "UserAnimeList_userId_status_idx" ON "UserAnimeList"("userId", "status");

-- CreateIndex
CREATE INDEX "UserAnimeList_userId_updatedAt_idx" ON "UserAnimeList"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_typeId_channel_key" ON "NotificationPreference"("userId", "typeId", "channel");

-- AddForeignKey
ALTER TABLE "UserAnimeList" ADD CONSTRAINT "UserAnimeList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAnimeList" ADD CONSTRAINT "UserAnimeList_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
