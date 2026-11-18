-- Colonne e tabella dei consensi per formato. Solo aggiunte: durante un
-- aggiornamento la versione precedente gira sullo stesso schema e le ignora.

-- I valori di partenza che un modello passa agli eventi che crea.
ALTER TABLE "event_templates" ADD COLUMN     "audience_anonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hosts_always_recorded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offer_address_book" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "post_event_show_qa" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recording_destination" "RecordingAudience";

-- La destinazione del video dichiarata prima della sala, e la rubrica proposta
-- nel modulo. Gli eventi esistenti non hanno una destinazione.
ALTER TABLE "events" ADD COLUMN     "offer_address_book" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recording_destination" "RecordingAudience";

-- L'email cifrata della voce in rubrica.
ALTER TABLE "persons" ADD COLUMN     "email" TEXT;

-- Il testo del consenso dato in sala: destinazione e versione.
ALTER TABLE "recording_consents" ADD COLUMN     "destination" "RecordingAudience",
ADD COLUMN     "text_version" INTEGER;

-- Due default, in quest'ordine: le righe esistenti restano false, cioe' fuori
-- dalla regola sulla trascrizione dal video, e ogni riga creata da qui in poi
-- nasce true, chiunque la crei, compresi i pod della versione precedente
-- durante un aggiornamento.
ALTER TABLE "recordings" ADD COLUMN     "transcript_consent_rule" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "recordings" ALTER COLUMN "transcript_consent_rule" SET DEFAULT true;

-- Il testo del consenso dato all'iscrizione: destinazione e versione.
ALTER TABLE "registrations" ADD COLUMN     "consent_recording_destination" "RecordingAudience",
ADD COLUMN     "consent_recording_version" INTEGER;

-- La rubrica dell'istanza.
ALTER TABLE "site_settings" ADD COLUMN     "address_book_enabled" BOOLEAN NOT NULL DEFAULT true;

-- Le prove dei consensi che restano finche' esiste il video.
CREATE TABLE "retained_consent_proofs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "holder_hash" VARCHAR(64) NOT NULL,
    "email_hash" VARCHAR(64),
    "display_name" TEXT,
    "name_removed_at" TIMESTAMP(3),
    "locale" VARCHAR(8),
    "text_version" INTEGER,
    "destination" "RecordingAudience",
    "given_at" TIMESTAMP(3) NOT NULL,
    "withdrawn_at" TIMESTAMP(3),
    "retained_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retained_consent_proofs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "retained_consent_proofs_event_id_idx" ON "retained_consent_proofs"("event_id");

CREATE INDEX "retained_consent_proofs_email_hash_idx" ON "retained_consent_proofs"("email_hash");

CREATE INDEX "persons_opted_in_to_address_book_opted_in_at_idx" ON "persons"("opted_in_to_address_book", "opted_in_at");

ALTER TABLE "retained_consent_proofs" ADD CONSTRAINT "retained_consent_proofs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
