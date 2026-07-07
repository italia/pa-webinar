-- Post-event follow-up email (opt-in per event).
-- Whether to send the thank-you + recap email when the event ends (default off).
ALTER TABLE "events" ADD COLUMN "post_event_email_enabled" BOOLEAN NOT NULL DEFAULT false;
-- Set once the emails have been enqueued, so the reminders cron doesn't resend.
ALTER TABLE "events" ADD COLUMN "post_event_email_sent_at" TIMESTAMP(3);
