-- Post-event recap.
-- Toggle: whether the recap section shows on the concluded event page (default on).
ALTER TABLE "events" ADD COLUMN "post_event_show_recap" BOOLEAN NOT NULL DEFAULT true;
-- Persisted anonymized aggregate snapshot (headcount, top questions, poll
-- results, top words, feedback avg). Generated lazily on first view and kept
-- here so it survives the retention cleanup that deletes the raw rows.
ALTER TABLE "events" ADD COLUMN "post_event_recap" JSONB;
ALTER TABLE "events" ADD COLUMN "post_event_recap_at" TIMESTAMP(3);
