-- Propostas pendentes deixam as cartas ativas para permitir ofertas concorrentes.
DROP INDEX "GachaTrade_offeredUserCardId_key";
DROP INDEX "GachaTrade_requestedUserCardId_key";

WITH pending_trade_cards AS (
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
UPDATE "UserCard"
SET "status" = 'ACTIVE'
WHERE "status" = 'ESCROW'
  AND "id" IN (SELECT "userCardId" FROM pending_trade_cards);

UPDATE "GachaTradeCard" tc
SET "escrowed" = false
FROM "GachaTrade" t
WHERE t."id" = tc."tradeId"
  AND t."status" = 'PENDING';
