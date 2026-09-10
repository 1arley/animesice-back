-- F3: enables notification dedupe + delete-on-undo by (userId, type, actor, target)
ALTER TABLE "Notification" ADD COLUMN "actorId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "targetId" TEXT;

CREATE INDEX "Notification_userId_type_actorId_targetId_createdAt_idx"
    ON "Notification"("userId", "type", "actorId", "targetId", "createdAt");
