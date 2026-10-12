-- Speed up only the original defaults; preserve animation values changed by an admin.
UPDATE "GachaConfig"
SET
  "value" = "value" || '{"crystalSpinDuration":0.9,"revealAt":1.2,"particleDuration":0.55,"effectsGap":0.18,"flipDuration":0.42}'::jsonb,
  "updatedAt" = NOW()
WHERE "key" = 'anim_roll'
  AND "value"->>'crystalSpinDuration' = '1.2'
  AND "value"->>'revealAt' = '1.8'
  AND "value"->>'particleDuration' = '0.65'
  AND "value"->>'effectsGap' = '0.12'
  AND "value"->>'flipDuration' = '0.48';
