CREATE TYPE "GachaMarketOfferStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TABLE "GachaMarketOffer" (
  "id" TEXT NOT NULL,
  "offeredUserId" TEXT NOT NULL,
  "requestedUserId" TEXT NOT NULL,
  "cardListingId" TEXT,
  "skinListingId" TEXT,
  "crystals" INTEGER NOT NULL DEFAULT 0,
  "status" "GachaMarketOfferStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  CONSTRAINT "GachaMarketOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GachaMarketOffer_crystals_check" CHECK ("crystals" >= 0),
  CONSTRAINT "GachaMarketOffer_listing_check" CHECK (
    ("cardListingId" IS NOT NULL) <> ("skinListingId" IS NOT NULL)
  )
);

CREATE TABLE "GachaMarketOfferCard" (
  "offerId" TEXT NOT NULL,
  "userCardId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "GachaMarketOfferCard_pkey" PRIMARY KEY ("offerId", "userCardId"),
  CONSTRAINT "GachaMarketOfferCard_position_check" CHECK ("position" >= 0)
);

CREATE INDEX "GachaMarketOffer_offeredUserId_status_createdAt_idx"
  ON "GachaMarketOffer"("offeredUserId", "status", "createdAt" DESC);
CREATE INDEX "GachaMarketOffer_requestedUserId_status_createdAt_idx"
  ON "GachaMarketOffer"("requestedUserId", "status", "createdAt" DESC);
CREATE INDEX "GachaMarketOffer_cardListingId_status_idx"
  ON "GachaMarketOffer"("cardListingId", "status");
CREATE INDEX "GachaMarketOffer_skinListingId_status_idx"
  ON "GachaMarketOffer"("skinListingId", "status");
CREATE INDEX "GachaMarketOffer_status_expiresAt_idx"
  ON "GachaMarketOffer"("status", "expiresAt");
CREATE UNIQUE INDEX "GachaMarketOfferCard_offerId_position_key"
  ON "GachaMarketOfferCard"("offerId", "position");
CREATE INDEX "GachaMarketOfferCard_userCardId_idx"
  ON "GachaMarketOfferCard"("userCardId");

ALTER TABLE "GachaMarketOffer"
  ADD CONSTRAINT "GachaMarketOffer_offeredUserId_fkey"
  FOREIGN KEY ("offeredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "GachaMarketOffer_requestedUserId_fkey"
  FOREIGN KEY ("requestedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "GachaMarketOffer_cardListingId_fkey"
  FOREIGN KEY ("cardListingId") REFERENCES "GachaListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GachaMarketOffer_skinListingId_fkey"
  FOREIGN KEY ("skinListingId") REFERENCES "GachaSkinListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GachaMarketOfferCard"
  ADD CONSTRAINT "GachaMarketOfferCard_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "GachaMarketOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "GachaMarketOfferCard_userCardId_fkey"
  FOREIGN KEY ("userCardId") REFERENCES "UserCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
