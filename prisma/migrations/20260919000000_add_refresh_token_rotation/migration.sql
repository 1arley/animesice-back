-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN "family" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RefreshToken" ADD COLUMN "replacedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RefreshToken_family_idx" ON "RefreshToken"("family");
