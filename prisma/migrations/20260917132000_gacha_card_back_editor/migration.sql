CREATE TYPE "GachaCosmeticStatus" AS ENUM ('DRAFT','REVIEW','PUBLISHED','ARCHIVED');
CREATE TABLE "GachaCardBack" ("id" TEXT NOT NULL,"key" TEXT NOT NULL,"name" TEXT NOT NULL,"description" TEXT,"svg" TEXT NOT NULL,"previewUrl" TEXT,"price" INTEGER NOT NULL DEFAULT 0,"version" INTEGER NOT NULL DEFAULT 1,"status" "GachaCosmeticStatus" NOT NULL DEFAULT 'DRAFT',"createdById" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "GachaCardBack_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "GachaCardBack_key_key" ON "GachaCardBack"("key");
CREATE INDEX "GachaCardBack_status_updatedAt_idx" ON "GachaCardBack"("status","updatedAt" DESC);
