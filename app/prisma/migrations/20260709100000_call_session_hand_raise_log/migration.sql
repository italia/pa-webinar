-- P1 analytics: persist the live hand-raise timeline on CallSession.
-- Additive, non-breaking: a JsonB column defaulting to an empty array,
-- mirroring dominant_speaker_log. Existing rows backfill to '[]'.
ALTER TABLE "call_sessions" ADD COLUMN "hand_raise_log" JSONB NOT NULL DEFAULT '[]';
