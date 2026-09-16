-- CreateTable
CREATE TABLE "CrystalEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "refId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrystalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GachaDailyBonus" (
    "userId" TEXT NOT NULL,
    "lastClaim" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "GachaDailyBonus_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "CrystalEvent_userId_createdAt_idx" ON "CrystalEvent"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "CrystalEvent" ADD CONSTRAINT "CrystalEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GachaDailyBonus" ADD CONSTRAINT "GachaDailyBonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
