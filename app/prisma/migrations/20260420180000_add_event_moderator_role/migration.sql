-- CreateEnum
CREATE TYPE "EventModeratorRole" AS ENUM ('MODERATOR', 'SPEAKER');

-- AlterTable
ALTER TABLE "event_moderators"
  ADD COLUMN "role" "EventModeratorRole" NOT NULL DEFAULT 'MODERATOR';
