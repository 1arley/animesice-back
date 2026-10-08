UPDATE "GachaConfig"
SET "value" = jsonb_set(
  jsonb_set("value", '{NEGATIVE}', "value" -> 'GOLD'),
  '{NORMAL}', to_jsonb(GREATEST(
    0,
    ("value" ->> 'NORMAL')::integer - ("value" ->> 'GOLD')::integer
  ))
)
WHERE "key" = 'foil_weights'
  AND "value" ? 'NORMAL'
  AND "value" ? 'GOLD'
  AND NOT ("value" ? 'NEGATIVE');

UPDATE "GachaConfig"
SET "value" = jsonb_set("value", '{NEGATIVE}', '5'::jsonb)
WHERE "key" = 'foil_mult'
  AND NOT ("value" ? 'NEGATIVE');
