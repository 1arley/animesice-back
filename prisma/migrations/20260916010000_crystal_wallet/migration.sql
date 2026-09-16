BEGIN;

LOCK TABLE "User", "UserCard", "CrystalEvent" IN SHARE ROW EXCLUSIVE MODE;

CREATE TYPE "CrystalEventType" AS ENUM ('INITIAL', 'MINT', 'DAILY', 'SPEND', 'PURCHASE', 'SALE', 'TAX', 'ADMIN');
ALTER TABLE "CrystalEvent" ALTER COLUMN "type" TYPE "CrystalEventType" USING "type"::"CrystalEventType";
ALTER TABLE "User" ADD COLUMN "crystalBalance" INTEGER NOT NULL DEFAULT 0;

UPDATE "User" AS u
SET "crystalBalance" = COALESCE((
    SELECT SUM(c."value") / 2 FROM "UserCard" AS c WHERE c."userId" = u."id"
), 0);

INSERT INTO "CrystalEvent" ("id", "userId", "type", "delta", "refId", "reason")
SELECT 'crystal-initial:' || u."id", u."id", 'INITIAL',
       u."crystalBalance" - COALESCE((
           SELECT SUM(e."delta") FROM "CrystalEvent" AS e WHERE e."userId" = u."id"
       ), 0),
       '20260916010000_crystal_wallet', 'Saldo inicial: metade do valor da colecao'
FROM "User" AS u;

ALTER TABLE "User" ADD CONSTRAINT "User_crystalBalance_nonnegative" CHECK ("crystalBalance" >= 0);

COMMIT;
