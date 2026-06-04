-- Default da template per semplificare il wizard (durata + pre-attivazione AI).
-- Tutti opzionali/con default: i template esistenti restano validi.
ALTER TABLE "event_templates" ADD COLUMN "default_duration_minutes" INTEGER;
ALTER TABLE "event_templates" ADD COLUMN "ai_transcript_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "event_templates" ADD COLUMN "ai_summary_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "event_templates" ADD COLUMN "ai_translation_enabled" BOOLEAN NOT NULL DEFAULT false;
