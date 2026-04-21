-- Co-organizer list for an event. Pure display metadata: name + optional
-- logo + optional website. No access rights. Separate from event_moderators
-- (which grants room access via magic link) and from the legacy
-- events.organizer_name single-string column (kept as fallback).

CREATE TABLE "event_organizers" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "event_id"   UUID         NOT NULL,
  "name"       VARCHAR(200) NOT NULL,
  "logo_url"   TEXT,
  "website_url" TEXT,
  "sort_order" INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "event_organizers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_organizers_event_id_sort_order_idx"
  ON "event_organizers" ("event_id", "sort_order");

ALTER TABLE "event_organizers"
  ADD CONSTRAINT "event_organizers_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
