/* Fragmento bônus sorteado no giro (5%): decidido no spin, concedido no claim. */
ALTER TABLE "GachaSpin" ADD COLUMN "bonusShard" TEXT;
ALTER TABLE "UserCard" ADD COLUMN "bonusShard" TEXT;
