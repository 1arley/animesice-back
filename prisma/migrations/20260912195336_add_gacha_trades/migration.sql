-- CreateEnum
CREATE TYPE "GachaTradeStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "GachaTrade" (
    "id" TEXT NOT NULL,
    "offeredUserId" TEXT NOT NULL,
    "offeredUserCardId" TEXT NOT NULL,
    "requestedUserId" TEXT NOT NULL,
    "requestedUserCardId" TEXT NOT NULL,
    "status" "GachaTradeStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "GachaTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GachaTrade_offeredUserId_status_idx" ON "GachaTrade"("offeredUserId", "status");

-- CreateIndex
CREATE INDEX "GachaTrade_requestedUserId_status_idx" ON "GachaTrade"("requestedUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GachaTrade_offeredUserCardId_key" ON "GachaTrade"("offeredUserCardId") WHERE (status = 'PENDING');

-- CreateIndex
CREATE UNIQUE INDEX "GachaTrade_requestedUserCardId_key" ON "GachaTrade"("requestedUserCardId") WHERE (status = 'PENDING');

-- AddForeignKey
ALTER TABLE "GachaTrade" ADD CONSTRAINT "GachaTrade_offeredUserCardId_fkey" FOREIGN KEY ("offeredUserCardId") REFERENCES "UserCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GachaTrade" ADD CONSTRAINT "GachaTrade_requestedUserCardId_fkey" FOREIGN KEY ("requestedUserCardId") REFERENCES "UserCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
