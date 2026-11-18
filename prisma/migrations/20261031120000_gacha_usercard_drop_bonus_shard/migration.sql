-- O selo de fragmento bônus não mora mais na carta: ele é anunciado na
-- prévia e o fragmento é creditado direto no inventário no claim, então a
-- coluna de UserCard vira lixo e é removida.
ALTER TABLE "UserCard" DROP COLUMN "bonusShard";
