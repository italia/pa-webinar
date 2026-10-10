-- Il resoconto dell'evento: nuovo tipo di lavoro della pipeline, che e'
-- dell'evento e non di una registrazione, e il resoconto congelato
-- sull'evento.
-- AlterEnum
ALTER TYPE "PostprodJobKind" ADD VALUE 'REPORT';

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "post_event_report" JSONB,
ADD COLUMN     "post_event_report_at" TIMESTAMP(3),
ADD COLUMN     "post_event_report_published" BOOLEAN NOT NULL DEFAULT false;

-- I lavori REPORT sono dell'evento: recording_id diventa facoltativo solo
-- per loro. La release precedente legge i lavori con il client tipizzato
-- solo per registrazione, per id noto o con campi scelti (conteggi,
-- completed_at), quindi non incontra mai una riga senza registrazione.
-- AlterTable
ALTER TABLE "postprod_jobs" ADD COLUMN     "event_id" UUID,
ALTER COLUMN "recording_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "postprod_jobs_event_id_kind_idx" ON "postprod_jobs"("event_id", "kind");

-- AddForeignKey
ALTER TABLE "postprod_jobs" ADD CONSTRAINT "postprod_jobs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un solo proprietario: la registrazione, o l'evento per il resoconto. Il
-- tipo si confronta come testo: il valore REPORT, aggiunto in questa stessa
-- migrazione, non si puo' ancora usare come enum.
ALTER TABLE "postprod_jobs" ADD CONSTRAINT "postprod_jobs_un_proprietario"
  CHECK ((recording_id IS NULL) <> (event_id IS NULL) AND ((event_id IS NOT NULL) = (kind::text = 'REPORT')));
