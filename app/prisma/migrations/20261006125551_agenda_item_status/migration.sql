-- CreateEnum
CREATE TYPE "AgendaItemStatus" AS ENUM ('PENDING', 'CURRENT', 'DONE', 'SKIPPED');

-- AlterTable
ALTER TABLE "event_agenda_items" ADD COLUMN     "planned_minutes" INTEGER,
ADD COLUMN     "started_at" TIMESTAMP(3),
ADD COLUMN     "status" "AgendaItemStatus" NOT NULL DEFAULT 'PENDING';

-- Gli argomenti gia' spuntati sono discussi.
UPDATE "event_agenda_items" SET "status" = 'DONE' WHERE "completed" = true;
