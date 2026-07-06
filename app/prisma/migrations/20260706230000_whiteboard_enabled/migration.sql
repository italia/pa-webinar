-- Per-event opt-in for the native Jitsi/Excalidraw whiteboard.
-- Off by default for scheduled events (moderator enables it in the wizard);
-- instant calls force it on at runtime and set it in DB. The toolbar button
-- additionally requires config.whiteboard.enabled server-side (Jitsi), so it
-- stays hidden where the whiteboard infra is not deployed.
ALTER TABLE "events" ADD COLUMN "whiteboard_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "event_templates" ADD COLUMN "whiteboard_enabled" BOOLEAN NOT NULL DEFAULT false;
