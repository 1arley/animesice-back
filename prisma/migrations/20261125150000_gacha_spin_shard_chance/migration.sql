INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt")
VALUES (
  'spin_shard_chance',
  '7.5'::jsonb,
  'Chance de fragmento bônus por giro (%)',
  'rates',
  NOW()
)
ON CONFLICT ("key") DO UPDATE
SET
  "value" = CASE
    WHEN jsonb_typeof("GachaConfig"."value") = 'number'
      AND ("GachaConfig"."value" #>> '{}')::numeric BETWEEN 0 AND 100
      THEN "GachaConfig"."value"
    ELSE EXCLUDED."value"
  END,
  "label" = EXCLUDED."label",
  "group" = EXCLUDED."group",
  "updatedAt" = NOW();
