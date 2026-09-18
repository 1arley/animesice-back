CREATE TABLE "AvatarFile" (
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,

    CONSTRAINT "AvatarFile_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "AvatarFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
