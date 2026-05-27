-- Postprod AI pipeline: TTS dubbing extension.
-- Adds DUB to job kinds + DUBBED_AUDIO/DUBBED_VIDEO to artifact types,
-- per-event ai_dubbing_enabled toggle, site-wide TTS engine selection.
-- Dubbing produces TTS neutro (NO voice clone) in target languages —
-- the AI Act Art. 50 disclosure stays prominent on every dubbed track.

-- ── Enum extensions ───────────────────────────────────────────
ALTER TYPE "PostprodJobKind" ADD VALUE 'DUB';

ALTER TYPE "PostprodArtifactType" ADD VALUE 'DUBBED_AUDIO';
ALTER TYPE "PostprodArtifactType" ADD VALUE 'DUBBED_VIDEO';

-- ── Event: per-event dubbing toggle ──────────────────────────
ALTER TABLE "events"
    ADD COLUMN "ai_dubbing_enabled" BOOLEAN NOT NULL DEFAULT false;

-- ── SiteSetting: TTS engine selection ─────────────────────────
ALTER TABLE "site_settings"
    ADD COLUMN "ai_tts_engine" TEXT NOT NULL DEFAULT 'piper';
