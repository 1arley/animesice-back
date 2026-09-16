ALTER TABLE "Notification" ADD COLUMN "claimed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Notification_userId_type_claimed_idx"
ON "Notification"("userId", "type", "claimed");
