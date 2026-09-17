CREATE TABLE "GachaRarity" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "pointsBase" INTEGER NOT NULL DEFAULT 0,
  "dropWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "color" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GachaRarity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GachaRarity_name_key" ON "GachaRarity"("name");
CREATE UNIQUE INDEX "GachaRarity_slug_key" ON "GachaRarity"("slug");
CREATE INDEX "GachaRarity_active_dropWeight_idx" ON "GachaRarity"("active", "dropWeight");
INSERT INTO "GachaRarity" ("id","name","slug","pointsBase","dropWeight","updatedAt") VALUES
  (gen_random_uuid()::text,'COMUM','comum',10,55,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'INCOMUM','incomum',25,25,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'RARA','rara',60,12,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'EPICA','epica',150,5.5,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'LENDARIA','lendaria',400,2,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'MITICA','mitica',800,0.4,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'GALACTICA','galactica',1600,0.1,CURRENT_TIMESTAMP);
