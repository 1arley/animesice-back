-- Busca fuzzy no catálogo: similaridade de trigramas (pg_trgm) + índices GIN
-- em lower(title)/lower(japaneseTitle) p/ acelerar lookups futuros por palavra
-- isolada. A query atual do serviço tokeniza via unnest (seq scan no catálogo,
-- sub-ms na escala atual) — os índices são margem de segurança p/ crescimento.
--
-- A extensão é habilitada se disponível; se o papel do banco não puder criar
-- extensões, a migration continua (RAISE NOTICE) e a busca degrada para a
-- contains atual no AnimeService (try/catch no caminho fuzzy). Cada índice em
-- bloco próprio: se um falhar, os demais ainda são criados.
--
-- Obs: alternativeTitles (String[]) não entra no índice — array_to_string não
-- é IMMUTABLE e não pode virar expressão de índice. A similaridade sobre ele
-- ainda é avaliada na query, só sem index scan.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE EXTENSION pg_trgm;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm não disponível — busca fuzzy desativada: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "anime_title_trgm_idx"
      ON "Anime" USING GIN (LOWER(title) gin_trgm_ops);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Índice anime_title_trgm_idx não criado: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "anime_japanese_title_trgm_idx"
      ON "Anime" USING GIN (LOWER("japaneseTitle") gin_trgm_ops);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Índice anime_japanese_title_trgm_idx não criado: %', SQLERRM;
END $$;
