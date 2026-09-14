-- CreateEnum
CREATE TYPE "GachaPointEventType" AS ENUM ('MINT', 'SPEND', 'SALE', 'TAX', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pointsBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GachaPointEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "type" "GachaPointEventType" NOT NULL,
    "refId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GachaPointEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GachaPointEvent_userId_createdAt_idx" ON "GachaPointEvent"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "GachaPointEvent" ADD CONSTRAINT "GachaPointEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

