-- O título é a fonte de verdade: versões dubladas contêm a palavra
-- "Dublado"; todas as demais são legendadas.
UPDATE "Anime"
SET "audio" = CASE
  WHEN "title" ~* '(^|[^[:alnum:]])dublado([^[:alnum:]]|$)'
    THEN 'DUBLADO'::"AudioType"
  ELSE 'LEGENDADO'::"AudioType"
END
WHERE "audio" IS DISTINCT FROM CASE
  WHEN "title" ~* '(^|[^[:alnum:]])dublado([^[:alnum:]]|$)'
    THEN 'DUBLADO'::"AudioType"
  ELSE 'LEGENDADO'::"AudioType"
END;
