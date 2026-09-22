-- AlterTable: add rankedValue column (backfilled from value)
ALTER TABLE "UserCard" ADD COLUMN "rankedValue" INTEGER NOT NULL DEFAULT 0;

-- Backfill: rankedValue = value for all existing cards
UPDATE "UserCard" SET "rankedValue" = "value";

-- Remove default after backfill
ALTER TABLE "UserCard" ALTER COLUMN "rankedValue" DROP DEFAULT;

-- Seed: apply_cost_pct config
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt")
VALUES ('apply_cost_pct', '0.10', 'Custo para aplicar ao ranking (fração da diferença)', 'economia', NOW());
