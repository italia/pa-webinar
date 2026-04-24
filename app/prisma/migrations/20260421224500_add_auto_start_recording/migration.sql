-- Add auto-start recording toggle to events and their templates.
-- When true AND recording_enabled is also true, the moderator "start recording?"
-- prompt is skipped and Jibri is triggered automatically on room open.

ALTER TABLE "events"
  ADD COLUMN "auto_start_recording" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "event_templates"
  ADD COLUMN "auto_start_recording" BOOLEAN NOT NULL DEFAULT false;
