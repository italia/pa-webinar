-- JVB scale-to-zero lifecycle
-- Adds PROVISIONING and IDLE states so the scaler can drop the JVB node
-- after a configurable grace period of conference inactivity.

-- 1) Extend EventStatus enum
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'PROVISIONING' BEFORE 'LIVE';
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'IDLE' AFTER 'LIVE';

-- 2) Event tracking columns for scale-to-zero
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "provisioning_started_at" TIMESTAMP(3);

-- Index to let the scaler query "events with stale last_active_at" fast
CREATE INDEX IF NOT EXISTS "events_status_last_active_idx"
  ON "events" ("status", "last_active_at");

-- 3) SiteSetting tuning columns
ALTER TABLE "site_settings"
  ADD COLUMN IF NOT EXISTS "jvb_inactive_grace_minutes" INTEGER NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS "jvb_pre_scale_minutes"      INTEGER NOT NULL DEFAULT 10;
