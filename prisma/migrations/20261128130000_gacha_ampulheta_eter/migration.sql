ALTER TABLE "GachaInventory" ADD COLUMN "ampulhetaEter" INTEGER NOT NULL DEFAULT 0;

INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt")
VALUES
  (
    'ampulheta_drop_chance',
    '0.5'::jsonb,
    'Chance de drop da Ampulheta do Éter no claim (%)',
    'rates',
    NOW()
  ),
  (
    'ampulheta_enabled',
    'true'::jsonb,
    'Habilitar drop da Ampulheta do Éter no claim',
    'economia',
    NOW()
  )
ON CONFLICT ("key") DO UPDATE
SET
  "value" = CASE "GachaConfig"."key"
    WHEN 'ampulheta_drop_chance' THEN
      CASE
        WHEN jsonb_typeof("GachaConfig"."value") = 'number' THEN
          CASE
            WHEN ("GachaConfig"."value" #>> '{}')::numeric BETWEEN 0 AND 100
              THEN "GachaConfig"."value"
            ELSE EXCLUDED."value"
          END
        ELSE EXCLUDED."value"
      END
    WHEN 'ampulheta_enabled' THEN
      CASE
        WHEN jsonb_typeof("GachaConfig"."value") = 'boolean'
          THEN "GachaConfig"."value"
        ELSE EXCLUDED."value"
      END
    ELSE EXCLUDED."value"
  END,
  "label" = EXCLUDED."label",
  "group" = EXCLUDED."group",
  "updatedAt" = NOW();
