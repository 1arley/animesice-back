-- AlterTable: add season column (default 1 — all existing episodes are S1)
ALTER TABLE "Episode" ADD COLUMN "season" INTEGER NOT NULL DEFAULT 1;

-- DropIndex: drop old unique (animeId, number)
DROP INDEX IF EXISTS "Episode_animeId_number_key";

-- CreateIndex: new unique (animeId, season, number) + index (animeId, season)
CREATE UNIQUE INDEX "Episode_animeId_season_number_key" ON "Episode"("animeId", "season", "number");
CREATE INDEX "Episode_animeId_season_idx" ON "Episode"("animeId", "season");
