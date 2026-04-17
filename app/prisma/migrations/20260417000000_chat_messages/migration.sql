-- Persisted chat messages for live events.
--
-- Replaces the previous Jitsi-XMPP transport (which was ephemeral and
-- left no audit trail). POST /api/events/<slug>/chat inserts here and
-- publishes on Redis `chat:<eventId>`; SSE stream subscribers fan out
-- to browser clients.
--
-- `hidden_at` is a soft-delete so a moderator can hide a message
-- (spam, PII leak) without losing the row for compliance / AI-summary
-- re-runs later.

CREATE TABLE "chat_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "sender_name" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "is_moderator" BOOLEAN NOT NULL DEFAULT false,
  "text" TEXT NOT NULL,
  "hidden_at" TIMESTAMP(3),
  "hidden_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_messages_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Query pattern: `GET /chat/history?since=<ts>` loads messages after a
-- cutoff, ordered by createdAt. Compound index covers it.
CREATE INDEX "chat_messages_event_id_created_at_idx"
  ON "chat_messages" ("event_id", "created_at");
