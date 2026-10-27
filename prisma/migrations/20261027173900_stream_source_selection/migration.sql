-- AlterTable
ALTER TABLE "EpisodeSource" ADD COLUMN     "mediaHost" TEXT,
ADD COLUMN     "mediaHostVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StreamExtractionJob" ADD COLUMN     "sourceId" TEXT;

-- CreateIndex
CREATE INDEX "EpisodeSource_mediaHostVerifiedAt_idx" ON "EpisodeSource"("mediaHostVerifiedAt");
