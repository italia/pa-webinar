-- Optional YouTube URL for the public video library.
--
-- Lets the moderator attach a YouTube video (legacy uploads, mirrored
-- livestreams) as the canonical recording for an event without relying
-- on the internal Jibri pipeline. The public library surfaces the YT
-- embed when this column is set and otherwise falls back to
-- `recording_url`.

ALTER TABLE "events"
  ADD COLUMN "youtube_url" TEXT;
