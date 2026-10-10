-- Sottotitoli live: attivi di default sugli eventi e nell'istanza.
-- AlterTable
ALTER TABLE "events" ADD COLUMN     "live_captions_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "live_captions_enabled" BOOLEAN NOT NULL DEFAULT true;
