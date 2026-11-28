ALTER TABLE "GachaInventory" ADD COLUMN IF NOT EXISTS "rouletteSpins" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "GachaRouletteSpin" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "prizeId" TEXT NOT NULL,
  "prizeLabel" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "itemId" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "reward" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GachaRouletteSpin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GachaRouletteSpin_userId_operationId_key"
  ON "GachaRouletteSpin"("userId", "operationId");

CREATE INDEX IF NOT EXISTS "GachaRouletteSpin_userId_createdAt_idx"
  ON "GachaRouletteSpin"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "GachaRouletteSpin_createdAt_idx"
  ON "GachaRouletteSpin"("createdAt");

CREATE INDEX IF NOT EXISTS "GachaRouletteSpin_category_idx"
  ON "GachaRouletteSpin"("category");

DO $$ BEGIN
  ALTER TABLE "GachaRouletteSpin"
    ADD CONSTRAINT "GachaRouletteSpin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
