ALTER TYPE "GachaPrizeCategory" ADD VALUE IF NOT EXISTS 'ESSENCE';

ALTER TABLE "GachaInventory"
  ADD COLUMN "essenciaComum" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "essenciaIncomum" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "essenciaRara" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "essenciaEpica" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "essenciaLendaria" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "essenciaMitica" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "essenciaGalactica" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CrystalCode"
  ALTER COLUMN "crystals" SET DEFAULT 0,
  ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';

UPDATE "GachaConfig"
SET "value" = jsonb_set(
  jsonb_set(
    jsonb_set("value", '{COMMON,ESSENCE}', '0'::jsonb, true),
    '{RARE,ESSENCE}', '0'::jsonb, true
  ),
  '{PREMIUM,ESSENCE}', '0'::jsonb, true
)
WHERE "key" = 'box_category_weights';

INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
  ('essence_shop_price', '{"ESSENCIA_COMUM":0,"ESSENCIA_INCOMUM":0,"ESSENCIA_RARA":0,"ESSENCIA_EPICA":0,"ESSENCIA_LENDARIA":0,"ESSENCIA_MITICA":0,"ESSENCIA_GALACTICA":0}'::jsonb, 'Preço das Essências', 'economia', NOW()),
  ('essence_shop_enabled', '{"ESSENCIA_COMUM":false,"ESSENCIA_INCOMUM":false,"ESSENCIA_RARA":false,"ESSENCIA_EPICA":false,"ESSENCIA_LENDARIA":false,"ESSENCIA_MITICA":false,"ESSENCIA_GALACTICA":false}'::jsonb, 'Loja de Essências habilitada', 'economia', NOW()),
  ('essence_kind_weights', '{"COMMON":{"ESSENCIA_COMUM":0,"ESSENCIA_INCOMUM":0,"ESSENCIA_RARA":0,"ESSENCIA_EPICA":0,"ESSENCIA_LENDARIA":0,"ESSENCIA_MITICA":0,"ESSENCIA_GALACTICA":0},"RARE":{"ESSENCIA_COMUM":0,"ESSENCIA_INCOMUM":0,"ESSENCIA_RARA":0,"ESSENCIA_EPICA":0,"ESSENCIA_LENDARIA":0,"ESSENCIA_MITICA":0,"ESSENCIA_GALACTICA":0},"PREMIUM":{"ESSENCIA_COMUM":0,"ESSENCIA_INCOMUM":0,"ESSENCIA_RARA":0,"ESSENCIA_EPICA":0,"ESSENCIA_LENDARIA":0,"ESSENCIA_MITICA":0,"ESSENCIA_GALACTICA":0}}'::jsonb, 'Pesos das Essências por baú', 'rates', NOW())
ON CONFLICT ("key") DO NOTHING;
