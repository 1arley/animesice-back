WITH latest AS (
  SELECT "snapshot" FROM "GachaEconomyVersion"
  WHERE "activeFrom" <= NOW()
  ORDER BY "activeFrom" DESC, "version" DESC LIMIT 1
), kinds(kind) AS (
  VALUES ('TITANITA'), ('TITANITA_SOMBRIA'), ('DRACONICA'),
         ('SOMBRIA_DRACONICA'), ('PROTECAO')
), tiers(tier) AS (
  VALUES ('COMMON'), ('RARE'), ('PREMIUM')
), availability AS (
  SELECT kinds.kind,
    NOT EXISTS (
      SELECT 1 FROM latest CROSS JOIN tiers
      WHERE COALESCE((latest.snapshot->'box_category_weights'->tiers.tier->>'ITEM')::numeric, 0) > 0
        AND COALESCE((latest.snapshot->'item_kind_weights'->tiers.tier->>kinds.kind)::numeric, 0) > 0
        AND EXISTS (
          SELECT 1 FROM jsonb_each_text(latest.snapshot->'box_quality_weights'->tiers.tier) quality(name, weight)
          WHERE quality.weight::numeric > 0
            AND (kinds.kind = 'PROTECAO' OR COALESCE((latest.snapshot->'item_qty_per_quality'->>quality.name)::numeric, 0) > 0)
        )
    ) AS shop_enabled
  FROM kinds
), enabled AS (
  SELECT jsonb_object_agg(kind, shop_enabled) AS value FROM availability
)
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt")
SELECT 'item_shop_enabled', enabled.value, 'Disponibilidade de compra direta por item', 'economia', NOW()
FROM enabled
ON CONFLICT ("key") DO NOTHING;

WITH latest AS (
  SELECT "snapshot" FROM "GachaEconomyVersion"
  WHERE "activeFrom" <= NOW()
  ORDER BY "activeFrom" DESC, "version" DESC LIMIT 1
), next_version AS (
  SELECT COALESCE(MAX("version"), 0) + 1 AS version FROM "GachaEconomyVersion"
)
INSERT INTO "GachaEconomyVersion" ("id", "version", "snapshot", "reason", "activeFrom")
SELECT gen_random_uuid(), next_version.version,
  latest."snapshot" || jsonb_build_object(
    'item_shop_enabled', (SELECT "value" FROM "GachaConfig" WHERE "key" = 'item_shop_enabled')
  ), 'Piloto loot boxes para fragmentos e proteção', NOW()
FROM next_version CROSS JOIN latest;
