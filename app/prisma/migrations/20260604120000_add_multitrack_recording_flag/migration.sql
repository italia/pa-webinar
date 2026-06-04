-- ADR-013 Fase 3/5 — opt-in evento per la registrazione audio per-partecipante
-- (multi-traccia). Default false: trattamento PII sensibile, va abilitato
-- esplicitamente dall'admin. Vedi Event.multitrackRecordingEnabled.
ALTER TABLE "events" ADD COLUMN "multitrack_recording_enabled" BOOLEAN NOT NULL DEFAULT false;
