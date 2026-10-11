ALTER TABLE "User"
ADD COLUMN "profileCover" TEXT,
ADD COLUMN "favoriteGachaCardIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "ProfileCoverFile" (
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileCoverFile_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "ProfileCoverFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
