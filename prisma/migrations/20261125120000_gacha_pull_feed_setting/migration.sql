INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt")
VALUES (
  'pull_posts_enabled',
  'true'::jsonb,
  'Divulgar pulls de cartas no feed',
  'social',
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
