-- Reactions mode (#7) + enable auto-close-on-inactivity by default (#12).

-- #7: reactions mode. 'NATIVE' (default) = Jitsi's own reactions button;
-- 'CUSTOM' = the app's analytics-backed ReactionBar. NOT NULL DEFAULT backfills
-- the existing singleton to NATIVE.
ALTER TABLE "site_settings"
  ADD COLUMN "reactions_mode" TEXT NOT NULL DEFAULT 'NATIVE';

-- #12: empty-conference auto-close default for NEW installs is 30 min. We only
-- change the column DEFAULT (affects rows created later) and deliberately do
-- NOT rewrite existing rows: -1 is both the historical default AND the operator
-- "disable" sentinel, so a blanket UPDATE would silently re-enable a terminal
-- auto-close for an admin who intentionally turned it off. Existing deployments
-- that want it on set the value explicitly in admin settings.
ALTER TABLE "site_settings"
  ALTER COLUMN "jvb_empty_close_minutes" SET DEFAULT 30;
