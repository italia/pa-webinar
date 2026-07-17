-- Reactions mode (#7) + enable auto-close-on-inactivity by default (#12).

-- #7: reactions mode. 'NATIVE' (default) = Jitsi's own reactions button;
-- 'CUSTOM' = the app's analytics-backed ReactionBar. NOT NULL DEFAULT backfills
-- the existing singleton to NATIVE.
ALTER TABLE "site_settings"
  ADD COLUMN "reactions_mode" TEXT NOT NULL DEFAULT 'NATIVE';

-- #12: empty-conference auto-close is now ON by default (15 min). Change the
-- column default AND flip the existing singleton from the old -1 (disabled) to
-- 15, without overriding an admin who already set a custom value.
ALTER TABLE "site_settings"
  ALTER COLUMN "jvb_empty_close_minutes" SET DEFAULT 15;
UPDATE "site_settings" SET "jvb_empty_close_minutes" = 15 WHERE "jvb_empty_close_minutes" = -1;
