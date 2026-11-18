-- Evento temporário de resgate (claim_event): janela de datas + raridades
-- sem cooldown. Inativo por padrão; admin edita via /admin/gacha/evento.
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
(
  'claim_event',
  '{"active":false,"name":"","startsAt":null,"endsAt":null,"tiers":[],"spinsPerHour":null}'::jsonb,
  'Evento temporário: resgate sem cooldown',
  'eventos',
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
