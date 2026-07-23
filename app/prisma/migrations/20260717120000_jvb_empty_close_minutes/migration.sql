-- Authoritative empty-conference close (feedback #12).
-- Minutes a LIVE room that HAD traffic may stay empty before the scaler
-- flips it straight to ENDED (terminal) — BEFORE endsAt and separate from
-- both the 45-min scale-to-zero grace (jvb_inactive_grace_minutes) and the
-- post-endsAt overtime grace (event_grace_period_minutes).
--   -1 (default) → disabled, preserves existing behaviour on rollout
--    0           → close on the first empty poll
--   N>0          → close after N minutes empty (recommended 10)
ALTER TABLE "site_settings" ADD COLUMN "jvb_empty_close_minutes" INTEGER NOT NULL DEFAULT -1;
