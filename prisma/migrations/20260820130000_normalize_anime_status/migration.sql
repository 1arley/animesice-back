-- Unifica os nomes históricos usados para animes que terminaram.
UPDATE "Anime"
SET "status" = 'FINALIZADO'
WHERE UPPER("status") IN ('COMPLETO', 'CONCLUIDO');
