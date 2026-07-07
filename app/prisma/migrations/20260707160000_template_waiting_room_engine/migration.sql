-- Pre-populate the waiting-room engine from an event template.
-- Nullable (like events.waiting_room_engine): NULL = fall back to the site
-- default (site_settings.waiting_room_engine). The WaitingRoomEngine enum type
-- already exists (migration 20260611210000_waiting_room_engine).
ALTER TABLE "event_templates" ADD COLUMN "waiting_room_engine" "WaitingRoomEngine";
