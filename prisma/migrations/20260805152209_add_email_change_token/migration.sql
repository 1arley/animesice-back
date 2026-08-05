/*
  Warnings:

  - Made the column `status` on table `Anime` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Anime" ALTER COLUMN "status" SET NOT NULL;

-- AlterTable
ALTER TABLE "_AnimeToGenre" ADD CONSTRAINT "_AnimeToGenre_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_AnimeToGenre_AB_unique";

-- CreateTable
CREATE TABLE "EmailChangeToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailChangeToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeToken_token_key" ON "EmailChangeToken"("token");

-- CreateIndex
CREATE INDEX "EmailChangeToken_userId_idx" ON "EmailChangeToken"("userId");

-- AddForeignKey
ALTER TABLE "EmailChangeToken" ADD CONSTRAINT "EmailChangeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
