CREATE TABLE "GachaItemOperation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "economyVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GachaItemOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GachaItemOperation_userId_operationId_key"
  ON "GachaItemOperation"("userId", "operationId");
CREATE INDEX "GachaItemOperation_createdAt_idx"
  ON "GachaItemOperation"("createdAt");
ALTER TABLE "GachaItemOperation"
  ADD CONSTRAINT "GachaItemOperation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('item_kind_weights', '{"COMMON":{"TITANITA":60,"TITANITA_SOMBRIA":30,"DRACONICA":0,"SOMBRIA_DRACONICA":0,"PROTECAO":10},"RARE":{"TITANITA":45,"TITANITA_SOMBRIA":35,"DRACONICA":0,"SOMBRIA_DRACONICA":0,"PROTECAO":20},"PREMIUM":{"TITANITA":10,"TITANITA_SOMBRIA":20,"DRACONICA":30,"SOMBRIA_DRACONICA":35,"PROTECAO":5}}', 'Pesos dos itens por caixa', 'rates', NOW()),
('item_qty_per_quality', '{"BASIC":1,"RARE":2,"EPIC":3,"LEGENDARY":5}', 'Fragmentos por qualidade', 'economia', NOW()),
('item_recipes', '{"TITANITA":3,"TITANITA_SOMBRIA":5,"DRACONICA":5,"SOMBRIA_DRACONICA":7}', 'Receitas de fabricação', 'economia', NOW()),
('item_eligibility', '{"TITANITA":{"foils":["NORMAL"],"sourceConditions":["POOR","PLAYED","EX"],"maxCondition":"NM"},"TITANITA_SOMBRIA":{"foils":["HOLO","GOLD","INK","PRISM"],"sourceConditions":["POOR","PLAYED","EX"],"maxCondition":"NM"},"DRACONICA":{"foils":["NORMAL"],"sourceConditions":["NM"],"maxCondition":"MINT"},"SOMBRIA_DRACONICA":{"foils":["HOLO","GOLD","INK","PRISM"],"sourceConditions":["NM"],"maxCondition":"MINT"}}', 'Elegibilidade das pedras', 'economia', NOW()),
('item_shop_price', '{"TITANITA":500,"TITANITA_SOMBRIA":1500,"DRACONICA":6500,"SOMBRIA_DRACONICA":0,"PROTECAO":400}', 'Preço dos itens e fragmentos', 'economia', NOW()),
('item_convert_value', '{"TITANITA":250,"TITANITA_SOMBRIA":750,"DRACONICA":3250,"SOMBRIA_DRACONICA":4500,"PROTECAO":0}', 'Valor de conversão de fragmentos', 'economia', NOW()),
('item_condition_anchor', '{"PLAYED":0.465,"EX":0.265,"NM":0.11,"MINT":0.035}', 'Âncoras de condition ao melhorar cartas', 'economia', NOW()),
('reroll_mint_clamp', '0.071', 'Trava de reroll fora de MINT', 'economia', NOW()),
('reroll_protection_mint_block', 'true', 'Bloquear proteção em cartas MINT', 'economia', NOW())
ON CONFLICT ("key") DO NOTHING;

UPDATE "GachaConfig"
SET "value" = jsonb_set(
  jsonb_set(
    jsonb_set("value", '{COMMON}', COALESCE("value"->'COMMON', '{}'::jsonb) || jsonb_build_object('ITEM', COALESCE("value"->'COMMON'->'ITEM', '4'::jsonb)), true),
    '{RARE}', COALESCE("value"->'RARE', '{}'::jsonb) || jsonb_build_object('ITEM', COALESCE("value"->'RARE'->'ITEM', '6'::jsonb)), true
  ),
  '{PREMIUM}', COALESCE("value"->'PREMIUM', '{}'::jsonb) || jsonb_build_object('ITEM', COALESCE("value"->'PREMIUM'->'ITEM', '15'::jsonb)), true
), "updatedAt" = NOW()
WHERE "key" = 'box_category_weights';

WITH latest AS (
  SELECT "snapshot" FROM "GachaEconomyVersion"
  WHERE "activeFrom" <= NOW()
  ORDER BY "activeFrom" DESC, "version" DESC LIMIT 1
), next_version AS (
  SELECT COALESCE(MAX("version"), 0) + 1 AS version FROM "GachaEconomyVersion"
)
INSERT INTO "GachaEconomyVersion" ("id", "version", "snapshot", "reason", "activeFrom")
SELECT gen_random_uuid(), next_version.version,
  COALESCE(latest."snapshot", '{}'::jsonb) || jsonb_build_object(
    'box_category_weights', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'box_category_weights'),
    'item_kind_weights', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_kind_weights'),
    'item_qty_per_quality', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_qty_per_quality'),
    'item_recipes', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_recipes'),
    'item_eligibility', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_eligibility'),
    'item_shop_price', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_shop_price'),
    'item_convert_value', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_convert_value'),
    'item_condition_anchor', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_condition_anchor'),
    'reroll_cost_pct', COALESCE((SELECT "value" FROM "GachaConfig" WHERE "key" = 'reroll_cost_pct'), '0.15'::jsonb),
    'reroll_mint_clamp', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'reroll_mint_clamp'),
    'reroll_protection_mint_block', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'reroll_protection_mint_block')
  ), 'Ativação e configuração de itens do gacha', NOW()
FROM next_version LEFT JOIN latest ON TRUE;
