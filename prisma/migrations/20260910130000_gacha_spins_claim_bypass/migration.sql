CREATE TABLE "GachaSpin" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "hour" TIMESTAMPTZ(6) NOT NULL,
  "slot" INTEGER NOT NULL,
  "cardId" TEXT NOT NULL,
  "condition" DOUBLE PRECISION NOT NULL,
  "foil" TEXT NOT NULL DEFAULT 'NORMAL',
  "value" INTEGER NOT NULL,
  "claimedAt" TIMESTAMPTZ(6),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GachaSpin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GachaSpin_userId_createdAt_idx" ON "GachaSpin"("userId", "createdAt" DESC);
ALTER TABLE "GachaSpin" ADD CONSTRAINT "GachaSpin_userId_hour_slot_key" UNIQUE ("userId", "hour", "slot");

ALTER TABLE "GachaSpin" ADD CONSTRAINT "GachaSpin_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GachaSpin" ADD CONSTRAINT "GachaSpin_cardId_fkey"
FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GachaClaimLock" (
  "userId" TEXT NOT NULL,
  "lockedUntil" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "GachaClaimLock_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "GachaClaimLock" ADD CONSTRAINT "GachaClaimLock_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GachaBypass" (
  "reference" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "paidAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GachaBypass_pkey" PRIMARY KEY ("reference")
);

CREATE INDEX "GachaBypass_userId_status_idx" ON "GachaBypass"("userId", "status");

ALTER TABLE "GachaBypass" ADD CONSTRAINT "GachaBypass_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
