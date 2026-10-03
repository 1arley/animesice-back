-- Loadout único de cosméticos: moldura e destaque equipados.
-- A capa continua em User.gachaCardBack (inalterado, retrocompatível).
ALTER TABLE "User"
ADD COLUMN "gachaLoadout" JSONB;