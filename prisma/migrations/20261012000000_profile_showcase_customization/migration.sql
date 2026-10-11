-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "avatarCrop" JSONB,
ADD COLUMN     "profileCoverCrop" JSONB,
ADD COLUMN     "profileBackgroundId" TEXT,
ADD COLUMN     "showcaseSections" TEXT[] NOT NULL DEFAULT ARRAY['FEATURED', 'FAVORITES', 'COLLECTION', 'MEDALS']::TEXT[];

-- CreateTable
CREATE TABLE "ProfileBackground" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileBackground_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileBackground_key_key" ON "ProfileBackground"("key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_profileBackgroundId_fkey" FOREIGN KEY ("profileBackgroundId") REFERENCES "ProfileBackground"("id") ON DELETE SET NULL ON UPDATE CASCADE;
