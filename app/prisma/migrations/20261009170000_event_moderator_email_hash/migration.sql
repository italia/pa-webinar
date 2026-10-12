-- Impronta dell'indirizzo sulle concessioni (hashEmail, come per gli account
-- dello staff). Serve all'export e alla cancellazione GDPR in autonomia, e
-- su una concessione da organizzatore riconosce l'account dello staff con lo
-- stesso indirizzo, che gestisce allora l'evento.
--
-- Le concessioni esistenti la ricevono a blocchi dalla pulizia giornaliera,
-- che legge l'indirizzo cifrato. Su una concessione da organizzatore, invece,
-- l'impronta si scrive solo per la via controllata (chi gestisce già
-- l'evento): un segno di organizzatore senza impronta qui si toglie, e chi lo
-- vuole lo ridà da quella via.

ALTER TABLE "event_moderators" ADD COLUMN "email_hash" VARCHAR(64);

CREATE INDEX "event_moderators_email_hash_idx" ON "event_moderators"("email_hash");

UPDATE "event_moderators" SET "organizer" = false WHERE "organizer" = true AND "email" IS NOT NULL;
