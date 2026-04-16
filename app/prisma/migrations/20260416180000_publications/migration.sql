-- Publications hub schema extensions.
--
-- 1. Event.library_listed — whether the event appears on the public
--    /video-library. Separate from `post_event_public` (which only
--    governs the single event detail page). Default false so new
--    events never leak into the library without an explicit decision.
-- 2. Event.cover_image_url — 16:9 banner for library cards. Falls back
--    to `image_url` when empty.
-- 3. EventType.LEGACY — "import-only" events (no Jitsi flow), used by
--    the YouTube import to stash title/description/speakers alongside
--    a `youtube_url`.

ALTER TABLE "events"
  ADD COLUMN "library_listed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cover_image_url" TEXT;

-- Legacy enum alter: append the new value. Postgres keeps existing
-- rows' values intact because we only add to the enum.
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'LEGACY';

-- Backfill: events that already had a published recording (or a
-- youtube URL) and public post-event visibility were effectively in
-- the library — preserve that by setting library_listed=true. New
-- admins won't have to retroactively re-publish what was already live.
UPDATE "events"
SET "library_listed" = true
WHERE "post_event_public" = true
  AND (
    ("recording_published" = true AND "recording_url" IS NOT NULL)
    OR "youtube_url" IS NOT NULL
  );
