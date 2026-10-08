-- Cristais em trocas, escrow real no UserCard e contrapropostas.

ALTER TABLE "GachaTrade"
  ADD COLUMN "crystalsOffered" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "crystalsRequested" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "parentTradeId" TEXT,
  ADD COLUMN "closedBy" TEXT,
  ADD COLUMN "closedReason" TEXT;

ALTER TABLE "GachaTrade" ADD CONSTRAINT "GachaTrade_crystals_check"
  CHECK ("crystalsOffered" >= 0 AND "crystalsRequested" >= 0);

ALTER TABLE "GachaTrade" ADD CONSTRAINT "GachaTrade_round_check"
  CHECK ("round" >= 1);

ALTER TABLE "GachaTradeCard"
  ADD COLUMN "escrowed" BOOLEAN NOT NULL DEFAULT false;

-- Cancel legacy proposals that already share a card. The old bundle path
-- allowed this, and the escrow index below cannot represent both proposals.
WITH trade_cards AS (
  SELECT tc."tradeId", tc."userCardId"
  FROM "GachaTradeCard" tc
  JOIN "GachaTrade" t ON t."id" = tc."tradeId"
  WHERE t."status" = 'PENDING'
  UNION
  SELECT t."id", t."offeredUserCardId"
  FROM "GachaTrade" t
  WHERE t."status" = 'PENDING'
    AND NOT EXISTS (
      SELECT 1 FROM "GachaTradeCard" tc
      WHERE tc."tradeId" = t."id" AND tc."userCardId" = t."offeredUserCardId"
    )
  UNION
  SELECT t."id", t."requestedUserCardId"
  FROM "GachaTrade" t
  WHERE t."status" = 'PENDING'
    AND NOT EXISTS (
      SELECT 1 FROM "GachaTradeCard" tc
      WHERE tc."tradeId" = t."id" AND tc."userCardId" = t."requestedUserCardId"
    )
), conflicting_cards AS (
  SELECT "userCardId"
  FROM trade_cards
  GROUP BY "userCardId"
  HAVING COUNT(DISTINCT "tradeId") > 1
), conflicting_trades AS (
  SELECT DISTINCT tc."tradeId"
  FROM trade_cards tc
  JOIN conflicting_cards cc USING ("userCardId")
)
UPDATE "GachaTrade" t
SET "status" = 'CANCELLED',
    "completedAt" = NOW(),
    "closedReason" = 'MIGRATION_CONFLICT'
FROM conflicting_trades ct
WHERE t."id" = ct."tradeId" AND t."status" = 'PENDING';

-- Existing PENDING trades predate escrow: migrate both bundle rows and the
-- legacy 1:1 anchor columns before the new accept path requires ESCROW.
UPDATE "GachaTradeCard" tc
SET "escrowed" = true
FROM "GachaTrade" t
WHERE t."id" = tc."tradeId" AND t."status" = 'PENDING';

WITH pending_cards AS (
  SELECT tc."userCardId"
  FROM "GachaTradeCard" tc
  JOIN "GachaTrade" t ON t."id" = tc."tradeId"
  WHERE t."status" = 'PENDING'
  UNION
  SELECT t."offeredUserCardId"
  FROM "GachaTrade" t
  WHERE t."status" = 'PENDING'
  UNION
  SELECT t."requestedUserCardId"
  FROM "GachaTrade" t
  WHERE t."status" = 'PENDING'
)
UPDATE "UserCard" uc
SET "status" = 'ESCROW'
FROM pending_cards pc
WHERE uc."id" = pc."userCardId" AND uc."status" = 'ACTIVE';

-- Uma carta fica em escrow no máximo por uma troca PENDING. A barreira real
-- contra trade duplicado é o UserCard.status = 'ESCROW' + este índice; o
-- service só converte o P2002 em 409.
CREATE UNIQUE INDEX "GachaTradeCard_userCardId_escrowed_key"
  ON "GachaTradeCard"("userCardId") WHERE "escrowed" = true;

CREATE INDEX "GachaTrade_status_expiresAt_idx"
  ON "GachaTrade"("status", "expiresAt");

ALTER TABLE "GachaTrade" ADD CONSTRAINT "GachaTrade_parentTradeId_fkey"
  FOREIGN KEY ("parentTradeId") REFERENCES "GachaTrade"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: TTL da contraproposta
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('trade_counter_ttl_ms', '604800000', 'TTL da contra-proposta em ms (7 dias)', 'trocas', NOW());
