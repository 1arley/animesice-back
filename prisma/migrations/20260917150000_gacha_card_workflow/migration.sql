CREATE TYPE "CardStatus" AS ENUM ('DRAFT', 'REVIEW', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "CardSource" AS ENUM ('MAL', 'MANUAL');

ALTER TABLE "Card"
  ADD COLUMN "status" "CardStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "source" "CardSource" NOT NULL DEFAULT 'MAL',
  ADD COLUMN "variantName" TEXT,
  ADD COLUMN "variantType" TEXT NOT NULL DEFAULT 'STANDARD';

UPDATE "Card" SET "status" = 'REVIEW' WHERE "animeId" IS NULL;

CREATE INDEX "Card_status_rarity_idx" ON "Card"("status", "rarity");
