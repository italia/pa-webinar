-- Per-event override for the site-wide `parse_title_kicker` editorial
-- toggle. Null = inherit from site_settings.parse_title_kicker; true/false
-- force the kicker rendering on/off for this event only. Kept nullable
-- (with no default) so existing rows stay on the site-wide behaviour.

ALTER TABLE "events"
  ADD COLUMN "parse_title_kicker" BOOLEAN;
