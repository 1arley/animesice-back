CREATE TABLE "CrystalCode" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "crystals" INTEGER NOT NULL,
  "maxUses" INTEGER,
  "uses" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ(6),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrystalCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrystalCode_code_key" ON "CrystalCode"("code");
CREATE INDEX "CrystalCode_active_expiresAt_idx" ON "CrystalCode"("active", "expiresAt");
CREATE TABLE "CrystalCodeRedemption" (
  "id" TEXT NOT NULL,
  "codeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrystalCodeRedemption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrystalCodeRedemption_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "CrystalCode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrystalCodeRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrystalCodeRedemption_codeId_userId_key" ON "CrystalCodeRedemption"("codeId", "userId");
CREATE INDEX "CrystalCodeRedemption_userId_createdAt_idx" ON "CrystalCodeRedemption"("userId", "createdAt" DESC);
