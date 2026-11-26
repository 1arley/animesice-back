DO $$
DECLARE u_id TEXT;
BEGIN
  SELECT "id" INTO u_id FROM "User" WHERE "userName" = 'and_008' LIMIT 1;
  IF u_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "CrystalEvent"
    WHERE "userId" = u_id AND "refId" = 'manual:foil-gem-points:and_008'
  ) THEN
    UPDATE "User" SET "crystalBalance" = "crystalBalance" + 86400 WHERE "id" = u_id;
    INSERT INTO "CrystalEvent" ("id", "userId", "delta", "type", "refId", "reason")
    VALUES (gen_random_uuid(), u_id, 86400, 'ADMIN', 'manual:foil-gem-points:and_008', 'Compensação única: gema de foil não concedeu pontos');
  END IF;
END $$;
