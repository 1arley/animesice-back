-- DropIndex
DROP INDEX IF EXISTS "ChatMessage_status_idx";

-- DropIndex
DROP INDEX IF EXISTS "ChatMessage_userId_idx";

-- DropIndex
DROP INDEX IF EXISTS "ChatMessage_animeSlug_episodeNumber_createdAt_idx";

-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT IF EXISTS "ChatMessage_userId_fkey";

-- DropTable
DROP TABLE IF EXISTS "ChatMessage";

-- AlterType: remove CHAT_MESSAGE from ReportTargetType enum
ALTER TYPE "ReportTargetType" RENAME TO "ReportTargetType_old";
CREATE TYPE "ReportTargetType" AS ENUM ('COMMENT', 'ROOM_MESSAGE', 'USER', 'ANIME');
ALTER TABLE "Report" ALTER COLUMN "targetType" TYPE "ReportTargetType" USING "targetType"::text::"ReportTargetType";
DROP TYPE "ReportTargetType_old";
