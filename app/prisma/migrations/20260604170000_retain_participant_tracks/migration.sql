-- ADR-013 — opt-in a conservare le tracce per-partecipante oltre la trascrizione
-- (archivio + riascolto). Default false = minimizzazione (purge dopo trascrizione).
ALTER TABLE "events" ADD COLUMN "retain_participant_tracks" BOOLEAN NOT NULL DEFAULT false;
