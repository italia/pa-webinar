-- Sottotitoli live nei modelli evento: accesi come sugli eventi.
-- AlterTable
ALTER TABLE "event_templates" ADD COLUMN     "live_captions_enabled" BOOLEAN NOT NULL DEFAULT true;
