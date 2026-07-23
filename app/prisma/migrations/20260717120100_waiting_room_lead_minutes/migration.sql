-- Registration-routing window + raised pre-scale default (feedback #1).

-- New routing window: minutes before startsAt inside which a registration goes
-- straight to the waiting room; earlier registrations see the thank-you/confirm
-- screen with an iCal link instead. NOT NULL DEFAULT 15 backfills the existing
-- singleton row automatically.
ALTER TABLE "site_settings"
  ADD COLUMN "waiting_room_lead_minutes" INTEGER NOT NULL DEFAULT 15;

-- Raise the pre-scale/greet window default 10 -> 15 (feedback #1a: the JVB node
-- should be warmed ~15 min before start).
ALTER TABLE "site_settings"
  ALTER COLUMN "jvb_pre_scale_minutes" SET DEFAULT 15;

-- Bump the existing singleton from the old default 10 to 15, without overriding
-- a value an admin has customised to something else.
UPDATE "site_settings" SET "jvb_pre_scale_minutes" = 15 WHERE "jvb_pre_scale_minutes" = 10;
