-- AlterTable
ALTER TABLE "events" ADD COLUMN     "recording_notified_at" TIMESTAMP(3),
ADD COLUMN     "recording_notify_enabled" BOOLEAN NOT NULL DEFAULT true;

-- Le registrazioni gia' pubbliche prima di questa colonna non generano un
-- avviso tardivo: risultano gia' avvisate.
UPDATE "events"
SET "recording_notified_at" = COALESCE("recording_published_at", CURRENT_TIMESTAMP)
WHERE ("recording_published" = true AND "recording_url" IS NOT NULL) OR "youtube_url" IS NOT NULL;
