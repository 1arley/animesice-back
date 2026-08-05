-- AlterTable
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING "role"::text::"Role";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "Anime_rating_idx" ON "Anime"("rating");

-- CreateIndex
CREATE INDEX "Episode_dateModified_idx" ON "Episode"("dateModified");
