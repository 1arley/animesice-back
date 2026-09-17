CREATE TYPE "GachaTradeCardSide" AS ENUM ('OFFERED', 'REQUESTED');

CREATE TABLE "GachaTradeCard" (
  "id" TEXT NOT NULL,
  "tradeId" TEXT NOT NULL,
  "userCardId" TEXT NOT NULL,
  "side" "GachaTradeCardSide" NOT NULL,
  "position" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  CONSTRAINT "GachaTradeCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GachaTradeCard_tradeId_side_position_key" ON "GachaTradeCard"("tradeId", "side", "position");
CREATE UNIQUE INDEX "GachaTradeCard_tradeId_userCardId_key" ON "GachaTradeCard"("tradeId", "userCardId");
CREATE INDEX "GachaTradeCard_userCardId_side_idx" ON "GachaTradeCard"("userCardId", "side");
ALTER TABLE "GachaTradeCard" ADD CONSTRAINT "GachaTradeCard_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "GachaTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaTradeCard" ADD CONSTRAINT "GachaTradeCard_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "UserCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
