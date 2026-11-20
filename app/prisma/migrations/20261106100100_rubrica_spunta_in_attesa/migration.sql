-- La spunta in attesa della conferma dal link personale, e gli indici per cercare
-- iscrizioni e inviti di un indirizzo in tutti gli eventi.
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "address_book_pending" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "registrations_email_hash_idx" ON "registrations"("email_hash");

CREATE INDEX IF NOT EXISTS "event_invitations_email_hash_idx" ON "event_invitations"("email_hash");
