CREATE TYPE "WishlistPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

ALTER TABLE "User" ADD COLUMN "gachaWishlistPublic" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "GachaCardWishlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "priority" "WishlistPriority" NOT NULL DEFAULT 'NORMAL',
    "acceptedFoils" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "minCondition" TEXT,
    "maxEdition" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GachaCardWishlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GachaSetWishlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "priority" "WishlistPriority" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GachaSetWishlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GachaCardWishlist_userId_cardId_key" ON "GachaCardWishlist"("userId", "cardId");
CREATE INDEX "GachaCardWishlist_cardId_priority_idx" ON "GachaCardWishlist"("cardId", "priority");
CREATE INDEX "GachaCardWishlist_userId_priority_idx" ON "GachaCardWishlist"("userId", "priority");
CREATE UNIQUE INDEX "GachaSetWishlist_userId_animeId_key" ON "GachaSetWishlist"("userId", "animeId");
CREATE INDEX "GachaSetWishlist_animeId_priority_idx" ON "GachaSetWishlist"("animeId", "priority");
CREATE INDEX "GachaSetWishlist_userId_priority_idx" ON "GachaSetWishlist"("userId", "priority");

ALTER TABLE "GachaCardWishlist" ADD CONSTRAINT "GachaCardWishlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaCardWishlist" ADD CONSTRAINT "GachaCardWishlist_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaSetWishlist" ADD CONSTRAINT "GachaSetWishlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaSetWishlist" ADD CONSTRAINT "GachaSetWishlist_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;
