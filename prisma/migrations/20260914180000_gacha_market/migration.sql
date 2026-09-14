-- CreateEnum
CREATE TYPE "GachaListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "GachaListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userCardId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "GachaListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "buyerId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GachaListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GachaListing_status_expiresAt_idx" ON "GachaListing"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "GachaListing_userId_status_idx" ON "GachaListing"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GachaListing_userCardId_key" ON "GachaListing"("userCardId") WHERE (status = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "GachaListing" ADD CONSTRAINT "GachaListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GachaListing" ADD CONSTRAINT "GachaListing_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "UserCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

