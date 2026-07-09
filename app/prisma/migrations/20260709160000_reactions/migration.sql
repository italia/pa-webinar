-- P1 analytics: persist live emoji reactions (one row per reaction click).
-- No PII — only the emoji + timestamp — for post-event counts and the
-- engagement timeline. Cascade-deletes with the event; the cleanup cron also
-- purges rows for archived events.
CREATE TABLE "reactions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reactions_event_id_created_at_idx" ON "reactions"("event_id", "created_at");

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
