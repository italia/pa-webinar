-- Le prove di sala di chi conduce portano la concessione o l'account anche sulla
-- trascrizione, e su entrambe le tabelle l'impronta dell'indirizzo: la
-- cancellazione chiesta dalla persona le raggiunge, anche dopo che la concessione
-- o l'account se ne sono andati. Solo colonne nuove e nullabili.

-- AlterTable
ALTER TABLE "multitrack_consents" ADD COLUMN     "email_hash" VARCHAR(64),
ADD COLUMN     "event_moderator_id" UUID,
ADD COLUMN     "staff_account_id" UUID;

-- AlterTable
ALTER TABLE "recording_consents" ADD COLUMN     "email_hash" VARCHAR(64);

-- CreateIndex
CREATE INDEX "multitrack_consents_event_moderator_id_idx" ON "multitrack_consents"("event_moderator_id");

-- CreateIndex
CREATE INDEX "multitrack_consents_staff_account_id_idx" ON "multitrack_consents"("staff_account_id");

-- CreateIndex
CREATE INDEX "multitrack_consents_email_hash_idx" ON "multitrack_consents"("email_hash");

-- CreateIndex
CREATE INDEX "recording_consents_email_hash_idx" ON "recording_consents"("email_hash");

-- AddForeignKey
ALTER TABLE "multitrack_consents" ADD CONSTRAINT "multitrack_consents_event_moderator_id_fkey" FOREIGN KEY ("event_moderator_id") REFERENCES "event_moderators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multitrack_consents" ADD CONSTRAINT "multitrack_consents_staff_account_id_fkey" FOREIGN KEY ("staff_account_id") REFERENCES "staff_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Le prove della trascrizione gia' scritte prendono il legame dalla prova della
-- registrazione dello stesso posto. Chi ha dato la sola trascrizione non ha una
-- riga da cui prenderlo e resta senza.
UPDATE "multitrack_consents" AS m
SET "event_moderator_id" = r."event_moderator_id",
    "staff_account_id" = r."staff_account_id"
FROM "recording_consents" AS r
WHERE r."event_id" = m."event_id"
  AND r."jitsi_user_id" = m."jitsi_user_id"
  AND (r."event_moderator_id" IS NOT NULL OR r."staff_account_id" IS NOT NULL);

-- L'impronta viene da chi la prova cita adesso.
UPDATE "recording_consents" AS c
SET "email_hash" = COALESCE(
  (SELECT g."email_hash" FROM "event_moderators" AS g WHERE g."id" = c."event_moderator_id"),
  (SELECT a."email_hash" FROM "staff_accounts" AS a WHERE a."id" = c."staff_account_id")
)
WHERE c."event_moderator_id" IS NOT NULL OR c."staff_account_id" IS NOT NULL;

UPDATE "multitrack_consents" AS c
SET "email_hash" = COALESCE(
  (SELECT g."email_hash" FROM "event_moderators" AS g WHERE g."id" = c."event_moderator_id"),
  (SELECT a."email_hash" FROM "staff_accounts" AS a WHERE a."id" = c."staff_account_id")
)
WHERE c."event_moderator_id" IS NOT NULL OR c."staff_account_id" IS NOT NULL;
