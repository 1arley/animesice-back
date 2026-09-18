ALTER TYPE "CrystalEventType" ADD VALUE 'FEATURED';
ALTER TYPE "CrystalEventType" ADD VALUE 'COLLECTION';

INSERT INTO "SiteSetting" ("key", "value") VALUES
  ('GACHA_ENGAGEMENT_PILOT_PERCENT', '10'),
  ('GACHA_ENGAGEMENT_PILOT_STARTED_AT', CURRENT_TIMESTAMP::TEXT)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "User"
  ADD COLUMN "featuredStartedAt" TIMESTAMPTZ(6),
  ADD COLUMN "featuredSettledAt" TIMESTAMPTZ(6),
  ADD COLUMN "featuredRemainder" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "favoriteCollectionId" TEXT,
  ADD COLUMN "pinnedCollectionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "User"
SET "featuredStartedAt" = CURRENT_TIMESTAMP,
    "featuredSettledAt" = CURRENT_TIMESTAMP
WHERE "featuredUserCardId" IS NOT NULL;

CREATE TABLE "GachaCardDiscovery" (
  "userId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "discoveredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GachaCardDiscovery_pkey" PRIMARY KEY ("userId", "cardId")
);

CREATE TABLE "GachaCollectionProgress" (
  "userId" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "reward25At" TIMESTAMPTZ(6),
  "reward50At" TIMESTAMPTZ(6),
  "reward100At" TIMESTAMPTZ(6),
  CONSTRAINT "GachaCollectionProgress_pkey" PRIMARY KEY ("userId", "collectionId", "version")
);

INSERT INTO "GachaCardDiscovery" ("userId", "cardId", "discoveredAt")
SELECT "userId", "cardId", MIN("obtainedAt")
FROM "UserCard"
WHERE "status" = 'ACTIVE'
GROUP BY "userId", "cardId"
ON CONFLICT DO NOTHING;

CREATE INDEX "GachaCardDiscovery_cardId_idx" ON "GachaCardDiscovery"("cardId");
CREATE INDEX "GachaCollectionProgress_collectionId_version_idx" ON "GachaCollectionProgress"("collectionId", "version");

ALTER TABLE "User" ADD CONSTRAINT "User_favoriteCollectionId_fkey"
  FOREIGN KEY ("favoriteCollectionId") REFERENCES "GachaCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GachaCardDiscovery" ADD CONSTRAINT "GachaCardDiscovery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaCardDiscovery" ADD CONSTRAINT "GachaCardDiscovery_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaCollectionProgress" ADD CONSTRAINT "GachaCollectionProgress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaCollectionProgress" ADD CONSTRAINT "GachaCollectionProgress_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "GachaCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
