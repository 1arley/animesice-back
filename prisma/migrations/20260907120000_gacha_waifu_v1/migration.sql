-- AlterTable
ALTER TABLE "Post" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TEXT',
ADD COLUMN "meta" JSONB;

-- AlterTable
ALTER TABLE "PrivacySettings" ADD COLUMN "showGacha" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Waifu" (
    "id" TEXT NOT NULL,
    "anilistCharacterId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "favourites" INTEGER NOT NULL DEFAULT 0,
    "rarity" TEXT NOT NULL DEFAULT 'COMUM',
    "animeId" TEXT,
    "animeTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Waifu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWaifu" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "waifuId" TEXT NOT NULL,
    "condition" DOUBLE PRECISION NOT NULL,
    "foil" TEXT NOT NULL DEFAULT 'NORMAL',
    "edition" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWaifu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Waifu_anilistCharacterId_key" ON "Waifu"("anilistCharacterId");

-- CreateIndex
CREATE INDEX "Waifu_rarity_idx" ON "Waifu"("rarity");

-- CreateIndex
CREATE INDEX "Waifu_animeId_idx" ON "Waifu"("animeId");

-- CreateIndex
CREATE INDEX "UserWaifu_userId_obtainedAt_idx" ON "UserWaifu"("userId", "obtainedAt" DESC);

-- CreateIndex
CREATE INDEX "UserWaifu_waifuId_edition_idx" ON "UserWaifu"("waifuId", "edition");

-- CreateIndex
CREATE INDEX "UserWaifu_userId_value_idx" ON "UserWaifu"("userId", "value" DESC);

-- AddForeignKey
ALTER TABLE "Waifu" ADD CONSTRAINT "Waifu_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWaifu" ADD CONSTRAINT "UserWaifu_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWaifu" ADD CONSTRAINT "UserWaifu_waifuId_fkey" FOREIGN KEY ("waifuId") REFERENCES "Waifu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
