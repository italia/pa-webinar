-- AlterTable
ALTER TABLE "email_outbox" ADD COLUMN     "dedup_key" TEXT;

-- Le righe gia' accodate con la chiave nei metadati la ricevono nella colonna,
-- cosi' un'email partita prima di questa migrazione non riparte. Se due righe
-- avessero la stessa chiave, la tiene solo la piu' vecchia.
UPDATE "email_outbox" AS e
SET "dedup_key" = e."metadata"->>'dedupKey'
WHERE e."metadata" ? 'dedupKey'
  AND e."id" = (
    SELECT x."id" FROM "email_outbox" AS x
    WHERE x."metadata"->>'dedupKey' = e."metadata"->>'dedupKey'
    ORDER BY x."created_at", x."id"
    LIMIT 1
  );

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_dedup_key_key" ON "email_outbox"("dedup_key");
