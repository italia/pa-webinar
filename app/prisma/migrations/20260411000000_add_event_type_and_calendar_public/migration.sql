-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SCHEDULED', 'INSTANT');

-- AlterTable: add event_type column to events
ALTER TABLE "events" ADD COLUMN "event_type" "EventType" NOT NULL DEFAULT 'SCHEDULED';

-- AlterTable: add calendar_public column to site_settings
ALTER TABLE "site_settings" ADD COLUMN "calendar_public" BOOLEAN NOT NULL DEFAULT false;
