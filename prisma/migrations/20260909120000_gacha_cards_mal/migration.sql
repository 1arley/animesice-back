-- DropForeignKey
ALTER TABLE "UserWaifu" DROP CONSTRAINT "UserWaifu_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserWaifu" DROP CONSTRAINT "UserWaifu_waifuId_fkey";

-- DropForeignKey
ALTER TABLE "Waifu" DROP CONSTRAINT "Waifu_animeId_fkey";

-- AlterTable
ALTER TABLE "Anime" ADD COLUMN     "malId" INTEGER;

-- DropTable
DROP TABLE "UserWaifu";

-- DropTable
DROP TABLE "Waifu";

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "malCharacterId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "favourites" INTEGER NOT NULL DEFAULT 0,
    "rarity" TEXT NOT NULL DEFAULT 'COMUM',
    "animeId" TEXT,
    "animeTitle" TEXT,
    "editionCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "condition" DOUBLE PRECISION NOT NULL,
    "foil" TEXT NOT NULL DEFAULT 'NORMAL',
    "edition" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Card_malCharacterId_key" ON "Card"("malCharacterId");

-- CreateIndex
CREATE INDEX "Card_rarity_idx" ON "Card"("rarity");

-- CreateIndex
CREATE INDEX "Card_animeId_idx" ON "Card"("animeId");

-- CreateIndex
CREATE INDEX "UserCard_userId_obtainedAt_idx" ON "UserCard"("userId", "obtainedAt" DESC);

-- CreateIndex
CREATE INDEX "UserCard_cardId_edition_idx" ON "UserCard"("cardId", "edition");

-- CreateIndex
CREATE INDEX "UserCard_userId_value_idx" ON "UserCard"("userId", "value" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Anime_malId_key" ON "Anime"("malId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

