-- Word cloud live tab is now OPT-IN (off by default) instead of always-on.
-- The tab stays hidden unless a moderator enables it (via the live feature
-- toggle bar) — the aggregate word cloud was rarely used and is slated to be
-- replaced by an AI-generated summary. DEFAULT false applies to existing rows
-- too (word cloud turned off everywhere; re-enable per event as needed).
ALTER TABLE "events" ADD COLUMN "word_cloud_enabled" BOOLEAN NOT NULL DEFAULT false;
