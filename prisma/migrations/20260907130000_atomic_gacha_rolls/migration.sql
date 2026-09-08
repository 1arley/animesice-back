ALTER TABLE "Waifu" ADD COLUMN "editionCounter" INTEGER NOT NULL DEFAULT 0;

UPDATE "Waifu" w
SET "editionCounter" = COALESCE((
  SELECT MAX(uw."edition") FROM "UserWaifu" uw WHERE uw."waifuId" = w."id"
), 0);

CREATE TABLE "GachaRollDay" (
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  CONSTRAINT "GachaRollDay_pkey" PRIMARY KEY ("userId", "day")
);

INSERT INTO "GachaRollDay" ("userId", "day")
SELECT DISTINCT "userId", ("obtainedAt" AT TIME ZONE 'UTC')::date
FROM "UserWaifu";

ALTER TABLE "GachaRollDay" ADD CONSTRAINT "GachaRollDay_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
