-- Chargebacks may make the available balance negative. Restricted actions check it in application code.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_crystalBalance_nonnegative";

CREATE TYPE "GachaOwnedItemStatus" AS ENUM ('ACTIVE', 'ESCROW', 'SOLD', 'REMOVED');
CREATE TYPE "GachaBoxTier" AS ENUM ('COMMON', 'RARE', 'PREMIUM');
CREATE TYPE "GachaPrizeCategory" AS ENUM ('CRYSTAL', 'SPIN_RESET', 'CARD', 'SKIN', 'KEY', 'CARD_BACK');
CREATE TYPE "GachaPrizeQuality" AS ENUM ('BASIC', 'RARE', 'EPIC', 'LEGENDARY');
CREATE TYPE "CrystalPaymentStatus" AS ENUM ('PENDING', 'PAID', 'REVERSED', 'EXPIRED');
CREATE TYPE "GachaMarketItemType" AS ENUM ('CARD', 'SKIN');
CREATE TYPE "GachaMarketOrderStatus" AS ENUM ('ACTIVE', 'FILLED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "GachaOfficialOfferType" AS ENUM ('CARD', 'SKIN', 'KEY', 'COMMON_BOX');

ALTER TYPE "UserCardStatus" ADD VALUE IF NOT EXISTS 'ESCROW';
ALTER TYPE "UserCardStatus" ADD VALUE IF NOT EXISTS 'SOLD';
ALTER TYPE "UserCardStatus" ADD VALUE IF NOT EXISTS 'REMOVED';
ALTER TYPE "CrystalEventType" ADD VALUE IF NOT EXISTS 'CHARGEBACK';

ALTER TABLE "User"
  ADD COLUMN "crystalReserved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "gachaMarketBlockedAt" TIMESTAMPTZ(6),
  ADD COLUMN "gachaMarketBlockReason" TEXT;

ALTER TABLE "UserGachaSkin"
  ADD COLUMN "rarity" TEXT NOT NULL DEFAULT 'COMMON',
  ADD COLUMN "status" "GachaOwnedItemStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "GachaSkin" ADD COLUMN "rarity" TEXT NOT NULL DEFAULT 'COMMON';

DROP INDEX IF EXISTS "UserGachaSkin_userId_skinId_key";
CREATE INDEX "UserGachaSkin_userId_skinId_status_idx" ON "UserGachaSkin"("userId", "skinId", "status");

CREATE TABLE "GachaInventory" (
  "userId" TEXT NOT NULL,
  "commonBoxes" INTEGER NOT NULL DEFAULT 0,
  "rareBoxes" INTEGER NOT NULL DEFAULT 0,
  "premiumBoxes" INTEGER NOT NULL DEFAULT 0,
  "keys" INTEGER NOT NULL DEFAULT 0,
  "spinResets" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "GachaInventory_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "GachaDailyClaim" (
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GachaDailyClaim_pkey" PRIMARY KEY ("userId", "day")
);
CREATE INDEX "GachaDailyClaim_userId_day_idx" ON "GachaDailyClaim"("userId", "day" DESC);

CREATE TABLE "GachaOpeningDay" (
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GachaOpeningDay_pkey" PRIMARY KEY ("userId", "day")
);

CREATE TABLE "GachaRetention" (
  "userId" TEXT NOT NULL,
  "weeklyRewardReady" BOOLEAN NOT NULL DEFAULT false,
  "weeklyRewardClaimedAt" DATE,
  "loyaltyDays" INTEGER NOT NULL DEFAULT 0,
  "loyaltyRarePlusReady" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "GachaRetention_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "GachaEconomyVersion" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "authorId" TEXT,
  "reason" TEXT NOT NULL,
  "activeFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GachaEconomyVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GachaEconomyVersion_version_key" ON "GachaEconomyVersion"("version");
CREATE INDEX "GachaEconomyVersion_activeFrom_idx" ON "GachaEconomyVersion"("activeFrom" DESC);

CREATE TABLE "GachaOpening" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "boxTier" "GachaBoxTier" NOT NULL,
  "category" "GachaPrizeCategory" NOT NULL,
  "quality" "GachaPrizeQuality" NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 1,
  "reward" JSONB NOT NULL,
  "economyVersionId" TEXT,
  "loyaltyGuaranteed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GachaOpening_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GachaOpening_userId_createdAt_idx" ON "GachaOpening"("userId", "createdAt" DESC);
CREATE INDEX "GachaOpening_economyVersionId_idx" ON "GachaOpening"("economyVersionId");

CREATE TABLE "CrystalPurchase" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reference" TEXT,
  "amountCents" INTEGER NOT NULL,
  "crystals" INTEGER NOT NULL,
  "status" "CrystalPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "checkoutUrl" TEXT,
  "paidAt" TIMESTAMPTZ(6),
  "reversedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrystalPurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrystalPurchase_reference_key" ON "CrystalPurchase"("reference");
CREATE UNIQUE INDEX "CrystalPurchase_userId_idempotencyKey_key" ON "CrystalPurchase"("userId", "idempotencyKey");
CREATE INDEX "CrystalPurchase_userId_createdAt_idx" ON "CrystalPurchase"("userId", "createdAt" DESC);
CREATE INDEX "CrystalPurchase_status_createdAt_idx" ON "CrystalPurchase"("status", "createdAt");

CREATE TABLE "GachaBuyOrder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemType" "GachaMarketItemType" NOT NULL,
  "cardId" TEXT,
  "skinId" TEXT,
  "foil" TEXT,
  "condition" TEXT,
  "maxEdition" INTEGER,
  "price" INTEGER NOT NULL,
  "status" "GachaMarketOrderStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  CONSTRAINT "GachaBuyOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GachaBuyOrder_userId_status_idx" ON "GachaBuyOrder"("userId", "status");
CREATE INDEX "GachaBuyOrder_itemType_cardId_price_idx" ON "GachaBuyOrder"("itemType", "cardId", "price" DESC);
CREATE INDEX "GachaBuyOrder_itemType_skinId_price_idx" ON "GachaBuyOrder"("itemType", "skinId", "price" DESC);
CREATE INDEX "GachaBuyOrder_status_expiresAt_idx" ON "GachaBuyOrder"("status", "expiresAt");

CREATE TABLE "GachaSkinListing" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userSkinId" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  "status" "GachaMarketOrderStatus" NOT NULL DEFAULT 'ACTIVE',
  "buyerId" TEXT,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  CONSTRAINT "GachaSkinListing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GachaSkinListing_userSkinId_key" ON "GachaSkinListing"("userSkinId") WHERE "status" = 'ACTIVE';
CREATE INDEX "GachaSkinListing_userId_status_idx" ON "GachaSkinListing"("userId", "status");
CREATE INDEX "GachaSkinListing_status_expiresAt_idx" ON "GachaSkinListing"("status", "expiresAt");

CREATE TABLE "GachaMarketSale" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "itemType" "GachaMarketItemType" NOT NULL,
  "userCardId" TEXT,
  "userSkinId" TEXT,
  "buyOrderId" TEXT,
  "price" INTEGER NOT NULL,
  "fee" INTEGER NOT NULL,
  "official" BOOLEAN NOT NULL DEFAULT false,
  "suspicious" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GachaMarketSale_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GachaMarketSale_buyOrderId_key" ON "GachaMarketSale"("buyOrderId");
CREATE INDEX "GachaMarketSale_itemType_createdAt_idx" ON "GachaMarketSale"("itemType", "createdAt" DESC);
CREATE INDEX "GachaMarketSale_userCardId_idx" ON "GachaMarketSale"("userCardId");
CREATE INDEX "GachaMarketSale_userSkinId_idx" ON "GachaMarketSale"("userSkinId");

CREATE TABLE "GachaOfficialOffer" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "slot" INTEGER NOT NULL,
  "itemType" "GachaOfficialOfferType" NOT NULL,
  "cardId" TEXT,
  "skinId" TEXT,
  "price" INTEGER NOT NULL,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB,
  "purchasedAt" TIMESTAMPTZ(6),
  CONSTRAINT "GachaOfficialOffer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GachaOfficialOffer_userId_day_slot_key" ON "GachaOfficialOffer"("userId", "day", "slot");
CREATE INDEX "GachaOfficialOffer_userId_day_idx" ON "GachaOfficialOffer"("userId", "day");

CREATE TABLE "GachaMarketVisit" (
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  CONSTRAINT "GachaMarketVisit_pkey" PRIMARY KEY ("userId", "day")
);

CREATE TABLE "GachaMarketMission" (
  "userId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "listingQualifiedAt" TIMESTAMPTZ(6),
  "claimedAt" TIMESTAMPTZ(6),
  CONSTRAINT "GachaMarketMission_pkey" PRIMARY KEY ("userId", "periodStart")
);

ALTER TABLE "GachaInventory" ADD CONSTRAINT "GachaInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaDailyClaim" ADD CONSTRAINT "GachaDailyClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaOpeningDay" ADD CONSTRAINT "GachaOpeningDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaRetention" ADD CONSTRAINT "GachaRetention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaOpening" ADD CONSTRAINT "GachaOpening_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaOpening" ADD CONSTRAINT "GachaOpening_economyVersionId_fkey" FOREIGN KEY ("economyVersionId") REFERENCES "GachaEconomyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrystalPurchase" ADD CONSTRAINT "CrystalPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GachaBuyOrder" ADD CONSTRAINT "GachaBuyOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaBuyOrder" ADD CONSTRAINT "GachaBuyOrder_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaBuyOrder" ADD CONSTRAINT "GachaBuyOrder_skinId_fkey" FOREIGN KEY ("skinId") REFERENCES "GachaSkin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaSkinListing" ADD CONSTRAINT "GachaSkinListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaSkinListing" ADD CONSTRAINT "GachaSkinListing_userSkinId_fkey" FOREIGN KEY ("userSkinId") REFERENCES "UserGachaSkin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GachaMarketSale" ADD CONSTRAINT "GachaMarketSale_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GachaMarketSale" ADD CONSTRAINT "GachaMarketSale_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GachaMarketSale" ADD CONSTRAINT "GachaMarketSale_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "UserCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GachaMarketSale" ADD CONSTRAINT "GachaMarketSale_userSkinId_fkey" FOREIGN KEY ("userSkinId") REFERENCES "UserGachaSkin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GachaMarketSale" ADD CONSTRAINT "GachaMarketSale_buyOrderId_fkey" FOREIGN KEY ("buyOrderId") REFERENCES "GachaBuyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GachaOfficialOffer" ADD CONSTRAINT "GachaOfficialOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaOfficialOffer" ADD CONSTRAINT "GachaOfficialOffer_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GachaOfficialOffer" ADD CONSTRAINT "GachaOfficialOffer_skinId_fkey" FOREIGN KEY ("skinId") REFERENCES "GachaSkin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GachaMarketVisit" ADD CONSTRAINT "GachaMarketVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaMarketMission" ADD CONSTRAINT "GachaMarketMission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "GachaEconomyVersion" ("id", "version", "snapshot", "reason")
SELECT gen_random_uuid(), 1, COALESCE(jsonb_object_agg("key", "value"), '{}'::jsonb), 'Configuração inicial consolidada'
FROM "GachaConfig";

CREATE UNIQUE INDEX "CrystalEvent_userId_type_refId_key"
  ON "CrystalEvent"("userId", "type", "refId")
  WHERE "refId" LIKE 'economy-v1:%';

-- Launch grants are idempotent through primary/unique keys.
INSERT INTO "GachaInventory" ("userId", "commonBoxes", "keys")
SELECT "id", 1, 1 FROM "User" WHERE "isVerified" = true
ON CONFLICT ("userId") DO NOTHING;

WITH grants AS (
  SELECT "userId", "collectionId", "version", 25 AS milestone, 950 AS delta
  FROM "GachaCollectionProgress" WHERE "reward25At" IS NOT NULL
  UNION ALL
  SELECT "userId", "collectionId", "version", 50, 2400
  FROM "GachaCollectionProgress" WHERE "reward50At" IS NOT NULL
  UNION ALL
  SELECT "userId", "collectionId", "version", 100, 5800
  FROM "GachaCollectionProgress" WHERE "reward100At" IS NOT NULL
), inserted AS (
  INSERT INTO "CrystalEvent" ("id", "userId", "type", "delta", "refId", "reason")
  SELECT gen_random_uuid(), "userId", 'COLLECTION', delta,
    'economy-v1:collection:' || "collectionId" || ':v' || "version" || ':' || milestone,
    'Ajuste retroativo da coleção'
  FROM grants
  ON CONFLICT ("userId", "type", "refId") WHERE "refId" LIKE 'economy-v1:%' DO NOTHING
  RETURNING "userId", "delta"
), totals AS (
  SELECT "userId", SUM("delta")::INTEGER AS total FROM inserted GROUP BY "userId"
)
UPDATE "User" SET "crystalBalance" = "crystalBalance" + totals.total
FROM totals WHERE "User"."id" = totals."userId";
