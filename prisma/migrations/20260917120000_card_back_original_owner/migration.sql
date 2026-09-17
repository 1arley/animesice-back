ALTER TABLE "User" ADD COLUMN "gachaCardBack" TEXT;
ALTER TABLE "UserCard" ADD COLUMN "originalUserId" TEXT;
UPDATE "UserCard" SET "originalUserId" = "userId" WHERE "originalUserId" IS NULL;
CREATE INDEX "UserCard_originalUserId_idx" ON "UserCard"("originalUserId");
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_originalUserId_fkey" FOREIGN KEY ("originalUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
