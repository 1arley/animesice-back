-- CreateEnum
CREATE TYPE "AnimeFormat" AS ENUM ('TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC');

-- CreateEnum
CREATE TYPE "AnimeSeason" AS ENUM ('WINTER', 'SPRING', 'SUMMER', 'FALL');

-- AlterTable
ALTER TABLE "Anime" ADD COLUMN     "alternativeTitles" TEXT[],
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "episodeCount" INTEGER,
ADD COLUMN     "format" "AnimeFormat" DEFAULT 'TV',
ADD COLUMN     "japaneseTitle" TEXT,
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "releaseDate" TIMESTAMP(3),
ADD COLUMN     "season" "AnimeSeason",
ADD COLUMN     "source" TEXT,
ADD COLUMN     "studios" TEXT[],
ADD COLUMN     "themes" TEXT[],
ADD COLUMN     "year" INTEGER;

-- CreateTable
CREATE TABLE "AnimeSchedule" (
    "id" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "time" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnimeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnimeSchedule_dayOfWeek_idx" ON "AnimeSchedule"("dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "AnimeSchedule_animeId_dayOfWeek_key" ON "AnimeSchedule"("animeId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Anime_year_idx" ON "Anime"("year");

-- CreateIndex
CREATE INDEX "Anime_season_idx" ON "Anime"("season");

-- CreateIndex
CREATE INDEX "Anime_format_idx" ON "Anime"("format");

-- CreateIndex
CREATE INDEX "Anime_audio_idx" ON "Anime"("audio");

-- CreateIndex
CREATE INDEX "Anime_published_idx" ON "Anime"("published");

-- CreateIndex
CREATE INDEX "Anime_createdAt_idx" ON "Anime"("createdAt");

-- AddForeignKey
ALTER TABLE "AnimeSchedule" ADD CONSTRAINT "AnimeSchedule_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;
