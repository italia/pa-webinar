-- ADR-013 Fase 0 — timeline dominant-speaker sulla CallSession.
ALTER TABLE "call_sessions" ADD COLUMN "dominant_speaker_log" JSONB NOT NULL DEFAULT '[]';

-- ADR-013 Fase 2 — tracce audio per-partecipante (multitrack recorder).
CREATE TABLE "recording_tracks" (
    "id"              UUID NOT NULL,
    "recording_id"    UUID NOT NULL,
    "participant_id"  TEXT NOT NULL,
    "display_name"    TEXT,
    "blob_key"        TEXT NOT NULL,
    "mime_type"       TEXT NOT NULL DEFAULT 'audio/ogg',
    "size_bytes"      BIGINT,
    "start_offset_ms" INTEGER NOT NULL DEFAULT 0,
    "duration_ms"     INTEGER,
    "audio_purged_at" TIMESTAMP(3),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_tracks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recording_tracks_recording_id_participant_id_key"
    ON "recording_tracks"("recording_id", "participant_id");
CREATE INDEX "recording_tracks_recording_id_idx"
    ON "recording_tracks"("recording_id");

ALTER TABLE "recording_tracks"
    ADD CONSTRAINT "recording_tracks_recording_id_fkey"
    FOREIGN KEY ("recording_id") REFERENCES "recordings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
