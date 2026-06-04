-- Altri default da template per il wizard (descrizione, retention, n° relatori).
ALTER TABLE "event_templates" ADD COLUMN "description_template" JSONB;
ALTER TABLE "event_templates" ADD COLUMN "default_retention_days" INTEGER;
ALTER TABLE "event_templates" ADD COLUMN "default_expected_speakers" INTEGER;
