ALTER TABLE "GachaSetWishlist" ALTER COLUMN "animeId" DROP NOT NULL;
ALTER TABLE "GachaSetWishlist" ADD COLUMN "animeTitle" TEXT;

CREATE UNIQUE INDEX "GachaSetWishlist_userId_animeTitle_key"
  ON "GachaSetWishlist"("userId", "animeTitle");
CREATE INDEX "GachaSetWishlist_animeTitle_priority_idx"
  ON "GachaSetWishlist"("animeTitle", "priority");

ALTER TABLE "GachaSetWishlist"
  ADD CONSTRAINT "GachaSetWishlist_target_check"
  CHECK (("animeId" IS NOT NULL AND "animeTitle" IS NULL)
      OR ("animeId" IS NULL AND "animeTitle" IS NOT NULL));
