UPDATE "GachaConfig"
SET "value" = '6'::jsonb,
    "label" = 'Dia da semana de início do Mercado Noturno'
WHERE "key" = 'night_market_start_day';

UPDATE "GachaConfig"
SET "value" = '2'::jsonb,
    "label" = 'Duração do Mercado Noturno em dias'
WHERE "key" = 'night_market_duration_days';

CREATE TABLE "GachaOfficialOfferReveal" (
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "revealedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GachaOfficialOfferReveal_pkey" PRIMARY KEY ("userId", "offerId")
);

CREATE INDEX "GachaOfficialOfferReveal_offerId_idx"
ON "GachaOfficialOfferReveal"("offerId");

ALTER TABLE "GachaOfficialOfferReveal"
ADD CONSTRAINT "GachaOfficialOfferReveal_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GachaOfficialOfferReveal"
ADD CONSTRAINT "GachaOfficialOfferReveal_offerId_fkey"
FOREIGN KEY ("offerId") REFERENCES "GachaOfficialOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
