-- La prova del consenso alla registrazione di chi conduce o interviene,
-- legata alla sua concessione nominale o al suo account dello staff.
-- Solo colonne facoltative: la release precedente le ignora.
ALTER TABLE "recording_consents" ADD COLUMN "event_moderator_id" UUID;
ALTER TABLE "recording_consents" ADD COLUMN "staff_account_id" UUID;

CREATE INDEX "recording_consents_event_moderator_id_idx" ON "recording_consents"("event_moderator_id");
CREATE INDEX "recording_consents_staff_account_id_idx" ON "recording_consents"("staff_account_id");

ALTER TABLE "recording_consents" ADD CONSTRAINT "recording_consents_event_moderator_id_fkey" FOREIGN KEY ("event_moderator_id") REFERENCES "event_moderators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recording_consents" ADD CONSTRAINT "recording_consents_staff_account_id_fkey" FOREIGN KEY ("staff_account_id") REFERENCES "staff_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
