UPDATE "GachaConfig"
SET "value" = jsonb_set(
  jsonb_set("value", '{INK}', "value" -> 'GOLD'),
  '{NORMAL}', to_jsonb(GREATEST(0, ("value" ->> 'NORMAL')::integer - ("value" ->> 'GOLD')::integer))
)
WHERE "key" = 'foil_weights'
  AND "value" ? 'NORMAL'
  AND "value" ? 'GOLD'
  AND NOT ("value" ? 'INK');

UPDATE "GachaConfig"
SET "value" = jsonb_set("value", '{INK}', "value" -> 'GOLD')
WHERE "key" = 'foil_mult'
  AND "value" ? 'GOLD'
  AND NOT ("value" ? 'INK');
