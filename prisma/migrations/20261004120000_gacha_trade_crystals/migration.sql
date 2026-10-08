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