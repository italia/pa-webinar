-- Postprod AI pipeline: adds Recording, PostprodJob, PostprodArtifact,
-- Speaker plus per-event AI feature flags, per-registration consent
-- columns and SiteSetting pipeline configuration. See
-- docs/POSTPROD.md and prisma/schema.prisma for design rationale.

-- ── Enums ──────────────────────────────────────────────────────
CREATE TYPE "RecordingStatus" AS ENUM (
    'READY',
    'POSTPROD_QUEUED',
    'POSTPROD_RUNNING',
    'POSTPROD_PARTIAL',
    'POSTPROD_DONE',
    'POSTPROD_FAILED',
    'ARCHIVED'
);

CREATE TYPE "PostprodJobKind" AS ENUM (
    'TRANSCRIBE',
    'SUMMARIZE',
    'TRANSLATE',
    'SUBTITLE'
);

CREATE TYPE "PostprodJobStatus" AS ENUM (
    'PENDING',
    'CLAIMED',
    'RUNNING',
    'DONE',
    'FAILED'
);

CREATE TYPE "PostprodArtifactType" AS ENUM (
    'TRANSCRIPT_JSON',
    'TRANSCRIPT_VTT',
    'TRANSCRIPT_TXT',
    'SUMMARY_MD',
    'SUBTITLE_VTT',
    'TRANSLATION_VTT',
    'TRANSLATION_MD'
);

-- ── Event: per-event AI feature flags ──────────────────────────
ALTER TABLE "events"
    ADD COLUMN "ai_transcript_enabled"   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ai_summary_enabled"      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ai_translation_enabled"  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ai_target_locales"       VARCHAR(200);

-- ── Registration: per-participant AI consent (Art. 6.1.a) ─────
ALTER TABLE "registrations"
    ADD COLUMN "ai_consent_transcript"   BOOLEAN,
    ADD COLUMN "ai_consent_summary"      BOOLEAN,
    ADD COLUMN "ai_consent_translation"  BOOLEAN;

-- ── SiteSetting: pipeline-wide configuration ──────────────────
ALTER TABLE "site_settings"
    ADD COLUMN "ai_pipeline_enabled"        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ai_default_target_locales"  TEXT NOT NULL DEFAULT 'en,fr',
    ADD COLUMN "ai_llm_provider"            TEXT NOT NULL DEFAULT 'vllm',
    ADD COLUMN "ai_asr_provider"            TEXT NOT NULL DEFAULT 'whisperx',
    ADD COLUMN "ai_max_concurrent_jobs"     INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN "ai_job_max_attempts"        INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN "ai_artifact_retention_days" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "ai_consent_disclosure"      JSONB NOT NULL DEFAULT '{}';

-- ── Recording ──────────────────────────────────────────────────
CREATE TABLE "recordings" (
    "id"               UUID NOT NULL,
    "call_session_id"  UUID NOT NULL,
    "event_id"         UUID NOT NULL,
    "blob_key"         TEXT NOT NULL,
    "duration_sec"     INTEGER,
    "file_size_bytes"  BIGINT,
    "source_language"  VARCHAR(8),
    "status"           "RecordingStatus" NOT NULL DEFAULT 'READY',
    "consent_snapshot" JSONB NOT NULL DEFAULT '{}',
    "run_count"        INTEGER NOT NULL DEFAULT 1,
    "retention_until"  TIMESTAMP(3),
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recordings_call_session_id_key"
    ON "recordings"("call_session_id");
CREATE INDEX "recordings_event_id_idx"  ON "recordings"("event_id");
CREATE INDEX "recordings_status_idx"    ON "recordings"("status");

ALTER TABLE "recordings"
    ADD CONSTRAINT "recordings_call_session_id_fkey"
    FOREIGN KEY ("call_session_id") REFERENCES "call_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recordings"
    ADD CONSTRAINT "recordings_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── PostprodJob ────────────────────────────────────────────────
CREATE TABLE "postprod_jobs" (
    "id"               UUID NOT NULL,
    "recording_id"     UUID NOT NULL,
    "kind"             "PostprodJobKind" NOT NULL,
    "payload"          JSONB NOT NULL,
    "status"           "PostprodJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"         INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leased_at"        TIMESTAMP(3),
    "leased_by"        TEXT,
    "started_at"       TIMESTAMP(3),
    "completed_at"     TIMESTAMP(3),
    "last_error"       TEXT,
    "idempotency_key"  TEXT NOT NULL,
    "depends_on_id"    UUID,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "postprod_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "postprod_jobs_idempotency_key_key"
    ON "postprod_jobs"("idempotency_key");
CREATE INDEX "postprod_jobs_status_next_attempt_at_idx"
    ON "postprod_jobs"("status", "next_attempt_at");
CREATE INDEX "postprod_jobs_recording_id_idx"
    ON "postprod_jobs"("recording_id");

ALTER TABLE "postprod_jobs"
    ADD CONSTRAINT "postprod_jobs_recording_id_fkey"
    FOREIGN KEY ("recording_id") REFERENCES "recordings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postprod_jobs"
    ADD CONSTRAINT "postprod_jobs_depends_on_id_fkey"
    FOREIGN KEY ("depends_on_id") REFERENCES "postprod_jobs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── PostprodArtifact ───────────────────────────────────────────
CREATE TABLE "postprod_artifacts" (
    "id"             UUID NOT NULL,
    "recording_id"   UUID NOT NULL,
    "job_id"         UUID NOT NULL,
    "type"           "PostprodArtifactType" NOT NULL,
    "language"       VARCHAR(8),
    "blob_key"       TEXT NOT NULL,
    "size_bytes"     BIGINT,
    "mime_type"      TEXT NOT NULL,
    "inline_body"    TEXT,
    "content_hash"   VARCHAR(64) NOT NULL,
    "is_synthetic"   BOOLEAN NOT NULL DEFAULT true,
    "watermark_type" TEXT,
    "model_id"       VARCHAR(120),
    "model_version"  VARCHAR(80),
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postprod_artifacts_pkey" PRIMARY KEY ("id")
);

-- Uniqueness: one (type, language) per recording — newer runs upsert
-- onto the same row so consumers always read latest. NULL language
-- is treated as distinct per Postgres' default semantics, which is
-- what we want for type-agnostic artifacts (TRANSCRIPT_JSON).
CREATE UNIQUE INDEX "postprod_artifacts_recording_id_type_language_key"
    ON "postprod_artifacts"("recording_id", "type", "language");
CREATE INDEX "postprod_artifacts_recording_id_idx"
    ON "postprod_artifacts"("recording_id");

ALTER TABLE "postprod_artifacts"
    ADD CONSTRAINT "postprod_artifacts_recording_id_fkey"
    FOREIGN KEY ("recording_id") REFERENCES "recordings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postprod_artifacts"
    ADD CONSTRAINT "postprod_artifacts_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "postprod_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Speaker (diarization → identity mapping) ──────────────────
CREATE TABLE "speakers" (
    "id"               UUID NOT NULL,
    "recording_id"     UUID NOT NULL,
    "diar_label"       VARCHAR(40) NOT NULL,
    "display_name"     TEXT,
    "person_id"        UUID,
    "total_speech_sec" INTEGER NOT NULL DEFAULT 0,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "speakers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "speakers_recording_id_diar_label_key"
    ON "speakers"("recording_id", "diar_label");
CREATE INDEX "speakers_person_id_idx" ON "speakers"("person_id");

ALTER TABLE "speakers"
    ADD CONSTRAINT "speakers_recording_id_fkey"
    FOREIGN KEY ("recording_id") REFERENCES "recordings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speakers"
    ADD CONSTRAINT "speakers_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "persons"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
