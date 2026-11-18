INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt")
VALUES (
  'claim_event',
  '{"active":false,"name":"","startsAt":null,"endsAt":null,"spinsPerHour":null}'::jsonb,
  'Evento de resgate do Gacha',
  'eventos',
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
