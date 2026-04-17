-- Orphan recording reconciliation support
--
-- orphan_recordings: tracks blobs that exist in object storage but are
-- not linked to any Event/CallSession row. Populated by the reconcile
-- cron, reviewed by the admin, swept by the cleanup cron after grace.

CREATE TABLE IF NOT EXISTS "orphan_recordings" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "blob_name"      TEXT        NOT NULL,
  "size_bytes"     BIGINT,
  "last_modified"  TIMESTAMP,
  "discovered_at"  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decision"       TEXT        NOT NULL DEFAULT 'pending',
  "note"           TEXT,
  CONSTRAINT "orphan_recordings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "orphan_recordings_blob_name_key"
  ON "orphan_recordings" ("blob_name");

CREATE INDEX IF NOT EXISTS "orphan_recordings_decision_idx"
  ON "orphan_recordings" ("decision");

CREATE INDEX IF NOT EXISTS "orphan_recordings_discovered_at_idx"
  ON "orphan_recordings" ("discovered_at");

-- Admin-tunable grace period for auto-cleanup (days). 0 disables.
ALTER TABLE "site_settings"
  ADD COLUMN IF NOT EXISTS "orphan_recording_grace_days" INTEGER NOT NULL DEFAULT 30;
