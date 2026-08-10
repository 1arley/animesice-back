-- AlterTable
ALTER TABLE "User" ADD COLUMN "userName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_userName_key" ON "User"("userName");
