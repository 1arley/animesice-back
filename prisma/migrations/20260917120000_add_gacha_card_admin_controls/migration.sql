ALTER TABLE "Card" ADD COLUMN "imageHidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserCard" ADD COLUMN "valueOverride" INTEGER;

CREATE TABLE "GachaAdminChange" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "cardId" TEXT,
    "userCardId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GachaAdminChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GachaAdminChange_cardId_createdAt_idx" ON "GachaAdminChange"("cardId", "createdAt" DESC);
CREATE INDEX "GachaAdminChange_userCardId_createdAt_idx" ON "GachaAdminChange"("userCardId", "createdAt" DESC);
CREATE INDEX "GachaAdminChange_adminId_createdAt_idx" ON "GachaAdminChange"("adminId", "createdAt" DESC);
