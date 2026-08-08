-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('SUGGESTION', 'BUG', 'REQUEST');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'WONT_FIX', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "AnimeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "alternativeTitle" TEXT,
    "notes" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnimeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimeRequestVote" (
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnimeRequestVote_pkey" PRIMARY KEY ("requestId","userId")
);

-- CreateTable
CREATE TABLE "SiteFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "adminNote" TEXT,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnimeRequest_status_createdAt_idx" ON "AnimeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AnimeRequest_userId_idx" ON "AnimeRequest"("userId");

-- CreateIndex
CREATE INDEX "AnimeRequest_title_idx" ON "AnimeRequest"("title");

-- CreateIndex
CREATE INDEX "AnimeRequestVote_userId_idx" ON "AnimeRequestVote"("userId");

-- CreateIndex
CREATE INDEX "SiteFeedback_type_status_createdAt_idx" ON "SiteFeedback"("type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SiteFeedback_userId_idx" ON "SiteFeedback"("userId");

-- AddForeignKey
ALTER TABLE "AnimeRequest" ADD CONSTRAINT "AnimeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimeRequestVote" ADD CONSTRAINT "AnimeRequestVote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AnimeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimeRequestVote" ADD CONSTRAINT "AnimeRequestVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteFeedback" ADD CONSTRAINT "SiteFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
