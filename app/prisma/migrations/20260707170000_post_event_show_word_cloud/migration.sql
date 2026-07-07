-- Standalone post-event word-cloud section toggle. Lets the aggregate word
-- cloud be shown (or hidden) independently of the recap card, which until now
-- was the only surface for it. Defaults to visible, like the other
-- post_event_show_* flags.
ALTER TABLE "events" ADD COLUMN "post_event_show_word_cloud" BOOLEAN NOT NULL DEFAULT true;
