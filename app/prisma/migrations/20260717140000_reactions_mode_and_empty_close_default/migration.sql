-- Reactions mode (#7) + enable auto-close-on-inactivity by default (#12).

-- #7: reactions mode. 'NATIVE' (default) = Jitsi's own reactions button;
-- 'CUSTOM' = the app's analytics-backed ReactionBar. NOT NULL DEFAULT backfills
-- the existing singleton to NATIVE.
ALTER TABLE "site_settings"
  ADD COLUMN "reactions_mode" TEXT NOT NULL DEFAULT 'NATIVE';

-- #12: the authoritative empty-close stays DISABLED by default (-1, as shipped
-- in v0.8.0). It is a TERMINAL LIVE->ENDED transition, and adversarial review
-- flagged real ejection risks (a stale/degraded participants=0 reading could
-- close a still-populated room; a break where everyone incl. the moderator
-- leaves could close a room people meant to return to). Safe auto-close for
-- inactivity is already provided by the revivable 45-min LIVE->IDLE grace, so
-- the terminal early-close remains an opt-in admin setting. No default change
-- and no row rewrite here.
