-- ADR-013 / audit recorder: la traccia audio è univoca PER SESSIONE, non
-- per partecipante. Un rejoin / mute→unmute dello stesso partecipante
-- produce un blob distinto (blobKey include il trackFileId). Il vecchio
-- vincolo (recording_id, participant_id) collassava le sessioni sullo stesso
-- upsert → l'audio del secondo intervento andava perso. Il worker
-- (multitrack.py) rifonde le righe dello stesso participant_id sotto un
-- unico speaker, quindi più righe per partecipante sono corrette.

-- 1) Rimuovi l'unicità per-partecipante.
DROP INDEX IF EXISTS "recording_tracks_recording_id_participant_id_key";

-- 2) Unicità per SESSIONE (blob distinto). Idempotente sul retry dell'ingest.
CREATE UNIQUE INDEX "recording_tracks_recording_id_blob_key_key"
    ON "recording_tracks"("recording_id", "blob_key");

-- 3) Mantieni l'accesso efficiente per (recording, partecipante) per il
--    merge/claim che raggruppano le tracce di uno stesso parlante.
CREATE INDEX "recording_tracks_recording_id_participant_id_idx"
    ON "recording_tracks"("recording_id", "participant_id");
