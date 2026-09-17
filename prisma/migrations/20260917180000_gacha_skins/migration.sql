ALTER TABLE "User"
  ADD COLUMN "equippedGachaSkinId" TEXT,
  ADD COLUMN "nextGachaSkinSpinAt" TIMESTAMPTZ(6);

CREATE TABLE "GachaSkin" (
  "id" TEXT NOT NULL,
  "cardId" TEXT,
  "name" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "blocked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GachaSkin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserGachaSkin" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "skinId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserGachaSkin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GachaSkin_active_blocked_idx" ON "GachaSkin"("active", "blocked");
CREATE INDEX "GachaSkin_cardId_idx" ON "GachaSkin"("cardId");
CREATE UNIQUE INDEX "UserGachaSkin_userId_skinId_key" ON "UserGachaSkin"("userId", "skinId");
CREATE INDEX "UserGachaSkin_userId_acquiredAt_idx" ON "UserGachaSkin"("userId", "acquiredAt" DESC);

ALTER TABLE "User" ADD CONSTRAINT "User_equippedGachaSkinId_fkey"
  FOREIGN KEY ("equippedGachaSkinId") REFERENCES "GachaSkin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GachaSkin" ADD CONSTRAINT "GachaSkin_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserGachaSkin" ADD CONSTRAINT "UserGachaSkin_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserGachaSkin" ADD CONSTRAINT "UserGachaSkin_skinId_fkey"
  FOREIGN KEY ("skinId") REFERENCES "GachaSkin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
