-- CreateTable
CREATE TABLE "SiteFeedbackUpvote" (
    "userId" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteFeedbackUpvote_pkey" PRIMARY KEY ("userId","feedbackId")
);

-- CreateTable
CREATE TABLE "PostShare" (
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostShare_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateIndex
CREATE INDEX "SiteFeedbackUpvote_feedbackId_idx" ON "SiteFeedbackUpvote"("feedbackId");

-- CreateIndex
CREATE INDEX "PostShare_postId_idx" ON "PostShare"("postId");

-- AddForeignKey
ALTER TABLE "SiteFeedbackUpvote" ADD CONSTRAINT "SiteFeedbackUpvote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteFeedbackUpvote" ADD CONSTRAINT "SiteFeedbackUpvote_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "SiteFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostShare" ADD CONSTRAINT "PostShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostShare" ADD CONSTRAINT "PostShare_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
