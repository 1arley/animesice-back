ALTER TABLE "GachaInventory"
  ADD COLUMN "foilExtractors" INTEGER NOT NULL DEFAULT 0;

INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('foil_extract_fragments', '{"default":10,"HOLO":10,"GOLD":10,"INK":10,"PRISM":10}'::jsonb, 'Fragmentos recuperados ao extrair foil', 'economia', NOW())
ON CONFLICT ("key") DO NOTHING;

UPDATE "GachaConfig"
SET "value" = '{"EXTRATOR_FOIL":2000}'::jsonb || "value",
    "updatedAt" = NOW()
WHERE "key" = 'item_shop_price'
  AND jsonb_typeof("value") = 'object';

UPDATE "GachaConfig"
SET "value" = '{"EXTRATOR_FOIL":true}'::jsonb || "value",
    "updatedAt" = NOW()
WHERE "key" = 'item_shop_enabled'
  AND jsonb_typeof("value") = 'object';

UPDATE "GachaConfig"
SET "value" = '{"EXTRATOR_FOIL":0}'::jsonb || "value",
    "updatedAt" = NOW()
WHERE "key" = 'item_convert_value'
  AND jsonb_typeof("value") = 'object';

UPDATE "GachaConfig"
SET "value" = jsonb_set(
  jsonb_set(
    jsonb_set(
      "value",
      '{COMMON}',
      '{"EXTRATOR_FOIL":0}'::jsonb || COALESCE("value"->'COMMON', '{}'::jsonb),
      true
    ),
    '{RARE}',
    '{"EXTRATOR_FOIL":0}'::jsonb || COALESCE("value"->'RARE', '{}'::jsonb),
    true
  ),
  '{PREMIUM}',
  '{"EXTRATOR_FOIL":0}'::jsonb || COALESCE("value"->'PREMIUM', '{}'::jsonb),
  true
),
"updatedAt" = NOW()
WHERE "key" = 'item_kind_weights'
  AND jsonb_typeof("value") = 'object';

WITH latest AS (
  SELECT "snapshot" FROM "GachaEconomyVersion"
  WHERE "activeFrom" <= NOW()
  ORDER BY "activeFrom" DESC, "version" DESC LIMIT 1
), next_version AS (
  SELECT COALESCE(MAX("version"), 0) + 1 AS version FROM "GachaEconomyVersion"
), patch AS (
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'foil_extract_fragments', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'foil_extract_fragments'),
    'item_shop_price', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_shop_price'),
    'item_shop_enabled', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_shop_enabled'),
    'item_convert_value', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_convert_value'),
    'item_kind_weights', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_kind_weights')
  )) AS value
)
INSERT INTO "GachaEconomyVersion" ("id", "version", "snapshot", "reason", "activeFrom")
SELECT gen_random_uuid(), next_version.version,
  latest."snapshot" || patch.value,
  'Extrator de Foil e configuração de recuperação de fragmentos',
  NOW()
FROM latest CROSS JOIN next_version CROSS JOIN patch;
