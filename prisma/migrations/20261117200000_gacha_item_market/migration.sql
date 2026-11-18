-- AlterEnum
ALTER TYPE "GachaMarketItemType" ADD VALUE 'ITEM';

-- AlterTable
ALTER TABLE "GachaMarketOffer" ADD COLUMN     "itemListingId" TEXT,
ADD COLUMN     "offeredItems" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "GachaMarketSale" ADD COLUMN     "itemId" TEXT,
ADD COLUMN     "quantity" INTEGER;

-- CreateTable
CREATE TABLE "GachaItemListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "GachaMarketOrderStatus" NOT NULL DEFAULT 'ACTIVE',
    "buyerId" TEXT,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "GachaItemListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GachaItemListing_userId_status_idx" ON "GachaItemListing"("userId", "status");

-- CreateIndex
CREATE INDEX "GachaItemListing_itemId_status_price_idx" ON "GachaItemListing"("itemId", "status", "price");

-- CreateIndex
CREATE INDEX "GachaItemListing_status_expiresAt_idx" ON "GachaItemListing"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "GachaMarketOffer_itemListingId_status_idx" ON "GachaMarketOffer"("itemListingId", "status");

-- AddForeignKey
ALTER TABLE "GachaItemListing" ADD CONSTRAINT "GachaItemListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GachaMarketOffer" ADD CONSTRAINT "GachaMarketOffer_itemListingId_fkey" FOREIGN KEY ("itemListingId") REFERENCES "GachaItemListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Replace the card/skin-only invariant with one covering all listing types.
ALTER TABLE "GachaMarketOffer" DROP CONSTRAINT "GachaMarketOffer_listing_check";

-- Every listing reserves a positive, indivisible item lot.
ALTER TABLE "GachaItemListing" ADD CONSTRAINT "GachaItemListing_positive_lot" CHECK ("quantity" > 0 AND "price" > 0);
ALTER TABLE "GachaMarketOffer" ADD CONSTRAINT "GachaMarketOffer_one_listing" CHECK (num_nonnulls("cardListingId", "skinListingId", "itemListingId") = 1);
