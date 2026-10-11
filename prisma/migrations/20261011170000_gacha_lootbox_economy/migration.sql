ALTER TYPE "GachaPrizeCategory" ADD VALUE IF NOT EXISTS 'RARE_BOX';
ALTER TYPE "GachaPrizeCategory" ADD VALUE IF NOT EXISTS 'KEY_RARE_BOX';
ALTER TYPE "GachaPrizeCategory" ADD VALUE IF NOT EXISTS 'KEY_PREMIUM_BOX';

UPDATE "GachaConfig"
SET "value" = '{"COMMON":500,"RARE":1500,"PREMIUM":5000}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'box_prices';

UPDATE "GachaConfig"
SET "value" = '{
  "COMMON":{"CRYSTAL":35,"SPIN_RESET":15,"CARD":8,"SKIN":25,"KEY":0,"CARD_BACK":2,"RARE_BOX":10,"KEY_RARE_BOX":4,"KEY_PREMIUM_BOX":1},
  "RARE":{"CRYSTAL":9,"SPIN_RESET":20,"CARD":25,"SKIN":30,"KEY":0,"CARD_BACK":12,"RARE_BOX":0,"KEY_RARE_BOX":0,"KEY_PREMIUM_BOX":4},
  "PREMIUM":{"CRYSTAL":5,"SPIN_RESET":25,"CARD":35,"SKIN":25,"KEY":0,"CARD_BACK":10,"RARE_BOX":0,"KEY_RARE_BOX":0,"KEY_PREMIUM_BOX":0}
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'box_category_weights';

WITH latest AS (
  SELECT "snapshot"
  FROM "GachaEconomyVersion"
  WHERE "activeFrom" <= NOW()
  ORDER BY "activeFrom" DESC, "version" DESC
  LIMIT 1
), next_version AS (
  SELECT COALESCE(MAX("version"), 0) + 1 AS version
  FROM "GachaEconomyVersion"
)
INSERT INTO "GachaEconomyVersion" ("id", "version", "snapshot", "reason", "activeFrom")
SELECT gen_random_uuid(), next_version.version,
  COALESCE(latest."snapshot", '{}'::jsonb) || jsonb_build_object(
    'box_prices', '{"COMMON":500,"RARE":1500,"PREMIUM":5000}'::jsonb,
    'box_category_weights', '{
      "COMMON":{"CRYSTAL":35,"SPIN_RESET":15,"CARD":8,"SKIN":25,"KEY":0,"CARD_BACK":2,"RARE_BOX":10,"KEY_RARE_BOX":4,"KEY_PREMIUM_BOX":1},
      "RARE":{"CRYSTAL":9,"SPIN_RESET":20,"CARD":25,"SKIN":30,"KEY":0,"CARD_BACK":12,"RARE_BOX":0,"KEY_RARE_BOX":0,"KEY_PREMIUM_BOX":4},
      "PREMIUM":{"CRYSTAL":5,"SPIN_RESET":25,"CARD":35,"SKIN":25,"KEY":0,"CARD_BACK":10,"RARE_BOX":0,"KEY_RARE_BOX":0,"KEY_PREMIUM_BOX":0}
    }'::jsonb
  ),
  'Rebalanceamento das lootboxes', NOW()
FROM next_version
LEFT JOIN latest ON TRUE;
