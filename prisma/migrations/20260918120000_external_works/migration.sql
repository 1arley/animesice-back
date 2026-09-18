ALTER TABLE "Anime" ADD COLUMN "externalUrl" TEXT;
ALTER TABLE "Anime" ADD COLUMN "externalSource" TEXT;

CREATE INDEX "Anime_externalSource_externalUrl_idx" ON "Anime"("externalSource", "externalUrl");
