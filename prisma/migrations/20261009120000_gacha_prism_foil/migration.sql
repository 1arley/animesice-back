-- NEGATIVE saiu do enum: invertia a arte e o usuario rejeitou. PRISM ocupa o
-- mesmo slot economico (peso 3, mult 5), entao nenhuma carta mintada muda de
-- valor e o drift de cardValue continua 0.
--
-- Rename, nao delete: as keys somem do enum, mas os snapshots antigos de
-- GachaEconomyVersion ainda carregam 'NEGATIVE'. Sem renomear aqui, um snapshot
-- legado voltaria a sortear um foil que a UI nao conhece. O merge em
-- economy.config.ts so cobre a key ausente, nao a obsolete.

UPDATE "GachaConfig"
SET "value" = ("value" - 'NEGATIVE') || jsonb_build_object('PRISM', "value" -> 'NEGATIVE')
WHERE "key" IN ('foil_weights', 'foil_mult')
  AND "value" ? 'NEGATIVE';

-- Cartas ja mintadas. foil e TEXT solta: nao ha CHECK nem enum a dropar.
UPDATE "UserCard" SET "foil" = 'PRISM' WHERE "foil" = 'NEGATIVE';
UPDATE "GachaSpin" SET "foil" = 'PRISM' WHERE "foil" = 'NEGATIVE';
UPDATE "GachaBuyOrder" SET "foil" = 'PRISM' WHERE "foil" = 'NEGATIVE';
UPDATE "GachaCardWishlist"
SET "acceptedFoils" = array_replace("acceptedFoils", 'NEGATIVE', 'PRISM')
WHERE 'NEGATIVE' = ANY("acceptedFoils");

-- GachaEconomyVersion NAO e renomeada aqui. Snapshot e historico imutavel, e
-- economy.config.ts descarta key fora de GACHA_FOILS ao ler:foil obsoleto em
-- snapshot legado para de ser sorteado no mesmo lugar que a key e filtrada.