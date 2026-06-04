-- Agenda/note live (checklist opt-in). Vedi Event.agendaEnabled + EventAgendaItem.
ALTER TABLE "events" ADD COLUMN "agenda_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "event_agenda_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "label" VARCHAR(500) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "event_agenda_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_agenda_items_event_id_idx" ON "event_agenda_items"("event_id");

ALTER TABLE "event_agenda_items" ADD CONSTRAINT "event_agenda_items_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
