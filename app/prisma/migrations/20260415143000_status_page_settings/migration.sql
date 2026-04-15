-- Admin-configurable knobs for the status page
ALTER TABLE "site_settings"
  ADD COLUMN IF NOT EXISTS "jvb_provisioning_timeout_minutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "status_poll_interval_seconds"     INTEGER NOT NULL DEFAULT 30;
