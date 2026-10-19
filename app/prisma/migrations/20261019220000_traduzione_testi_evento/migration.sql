-- La traduzione automatica di titolo e descrizione dell'evento: nuovo tipo di
-- lavoro della pipeline, dell'evento come il resoconto, e la proposta di
-- traduzione salvata sull'evento (non tocca titolo e descrizione).
-- AlterEnum
ALTER TYPE "PostprodJobKind" ADD VALUE 'TRANSLATE_TEXT';

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "text_translations" JSONB;

-- Un solo proprietario: la registrazione, o l'evento per il resoconto e per
-- la traduzione dei testi. Il tipo si confronta come testo: il valore
-- TRANSLATE_TEXT, aggiunto in questa stessa migrazione, non si puo' ancora
-- usare come enum. Le righe esistenti rispettano gia' la regola nuova, che
-- allarga quella di prima.
ALTER TABLE "postprod_jobs" DROP CONSTRAINT "postprod_jobs_un_proprietario";
ALTER TABLE "postprod_jobs" ADD CONSTRAINT "postprod_jobs_un_proprietario"
  CHECK ((recording_id IS NULL) <> (event_id IS NULL) AND ((event_id IS NOT NULL) = (kind::text IN ('REPORT', 'TRANSLATE_TEXT'))));
