-- Itens de loot box (decisão laya-loot-items-20261023): fragmentos de pedra,
-- itens de pedra e proteção de reroll no inventário gacha.
ALTER TYPE "GachaPrizeCategory" ADD VALUE IF NOT EXISTS 'ITEM';

ALTER TABLE "GachaInventory"
  ADD COLUMN "titanitaShards" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "titanitaSombriaShards" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "draconicaShards" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sombriaDraconicaShards" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "titanitaItems" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "titanitaSombriaItems" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "draconicaItems" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sombriaDraconicaItems" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "protecao" INTEGER NOT NULL DEFAULT 0;
