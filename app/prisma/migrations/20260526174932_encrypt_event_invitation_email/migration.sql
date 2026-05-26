-- Bump the email column so ciphertext fits (legacy plaintext is well under 200).
ALTER TABLE "event_invitations" ALTER COLUMN "email" TYPE VARCHAR(500);

-- New column carrying a deterministic HMAC of the normalized email.
-- Nullable so existing plaintext rows survive the deploy untouched —
-- they'll be backfilled lazily (or via a future re-encryption cron).
ALTER TABLE "event_invitations" ADD COLUMN "email_hash" VARCHAR(64);

-- Per-event uniqueness moves to the hash column (the random IV in the
-- ciphertext makes the email column useless for uniqueness checks).
-- The unique constraint on (event_id, email) is kept too: it still
-- protects legacy plaintext rows during the transition.
CREATE UNIQUE INDEX "event_invitations_event_id_email_hash_key"
  ON "event_invitations"("event_id", "email_hash");
