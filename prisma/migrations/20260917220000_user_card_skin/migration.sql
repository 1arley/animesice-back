ALTER TABLE "UserCard" ADD COLUMN "skinId" TEXT;

CREATE INDEX "UserCard_skinId_idx" ON "UserCard"("skinId");

ALTER TABLE "UserCard"
ADD CONSTRAINT "UserCard_skinId_fkey"
FOREIGN KEY ("skinId") REFERENCES "GachaSkin"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
