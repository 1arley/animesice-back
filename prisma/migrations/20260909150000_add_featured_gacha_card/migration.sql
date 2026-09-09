ALTER TABLE "User" ADD COLUMN "featuredUserCardId" TEXT;

CREATE UNIQUE INDEX "User_featuredUserCardId_key" ON "User"("featuredUserCardId");

ALTER TABLE "User" ADD CONSTRAINT "User_featuredUserCardId_fkey" FOREIGN KEY ("featuredUserCardId") REFERENCES "UserCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
