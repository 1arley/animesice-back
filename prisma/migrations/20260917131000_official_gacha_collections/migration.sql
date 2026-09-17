CREATE TABLE "GachaCollection" ("id" TEXT NOT NULL,"name" TEXT NOT NULL,"slug" TEXT NOT NULL,"description" TEXT,"version" INTEGER NOT NULL DEFAULT 1,"published" BOOLEAN NOT NULL DEFAULT false,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "GachaCollection_pkey" PRIMARY KEY ("id"));
CREATE TABLE "GachaCollectionMember" ("collectionId" TEXT NOT NULL,"cardId" TEXT NOT NULL,CONSTRAINT "GachaCollectionMember_pkey" PRIMARY KEY ("collectionId","cardId"));
CREATE UNIQUE INDEX "GachaCollection_slug_key" ON "GachaCollection"("slug");
CREATE INDEX "GachaCollection_published_updatedAt_idx" ON "GachaCollection"("published","updatedAt" DESC);
CREATE INDEX "GachaCollectionMember_cardId_idx" ON "GachaCollectionMember"("cardId");
ALTER TABLE "GachaCollectionMember" ADD CONSTRAINT "GachaCollectionMember_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "GachaCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GachaCollectionMember" ADD CONSTRAINT "GachaCollectionMember_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
