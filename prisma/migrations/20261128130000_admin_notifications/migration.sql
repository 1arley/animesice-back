-- CreateEnum
CREATE TYPE "AdminNotificationCategory" AS ENUM ('THANKS', 'ANNOUNCEMENT', 'UPDATE', 'EVENT', 'COMPENSATION', 'GENERAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AdminNotificationAudience" AS ENUM ('SINGLE', 'SELECTED', 'GLOBAL');

-- AlterTable
ALTER TABLE "Notification"
  ADD COLUMN "adminNotificationId" TEXT,
  ADD COLUMN "adminCategory" "AdminNotificationCategory";

-- CreateTable
CREATE TABLE "AdminNotification" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "category" "AdminNotificationCategory" NOT NULL,
  "audience" "AdminNotificationAudience" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "linkUrl" TEXT,
  "dedupeKey" TEXT,
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminNotification_createdAt_idx" ON "AdminNotification"("createdAt");

-- CreateIndex
CREATE INDEX "AdminNotification_category_createdAt_idx" ON "AdminNotification"("category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotification_adminId_dedupeKey_key" ON "AdminNotification"("adminId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_adminNotificationId_idx" ON "Notification"("adminNotificationId");

-- AddForeignKey
ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_adminNotificationId_fkey" FOREIGN KEY ("adminNotificationId") REFERENCES "AdminNotification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
