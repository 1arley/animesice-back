-- CreateEnum
CREATE TYPE "GachaCosmeticType" AS ENUM ('BACK', 'FRAME', 'HIGHLIGHT');

-- AlterTable: add type column with default BACK, make svg nullable
ALTER TABLE "GachaCardBack" ADD COLUMN "type" "GachaCosmeticType" NOT NULL DEFAULT 'BACK';
ALTER TABLE "GachaCardBack" ALTER COLUMN "svg" DROP NOT NULL;

-- Seed the 3 cosmetics that were hardcoded in GACHA_COSMETICS
INSERT INTO "GachaCardBack" ("id", "key", "name", "description", "type", "svg", "price", "status", "version", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid(),
    'BACK_ICE',
    'Verso Ice',
    'Verso azul cristalino para suas cartas.',
    'BACK',
    NULL,
    1200,
    'PUBLISHED',
    1,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'FRAME_AURORA',
    'Moldura Aurora',
    'Suas cartas exibem uma moldura arco-íris em todas as telas do gacha.',
    'FRAME',
    NULL,
    1500,
    'PUBLISHED',
    1,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'DESTAQUE_CARTA',
    'Destaque de Carta',
    'Suas cartas ganham brilho dourado na página pública compartilhada.',
    'HIGHLIGHT',
    NULL,
    3000,
    'PUBLISHED',
    1,
    NOW(),
    NOW()
  );
