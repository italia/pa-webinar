-- Glossario della post-produzione AI (lib/ai/glossary.ts): voci d'istanza
-- (event_id NULL) e dell'evento.

-- CreateTable
CREATE TABLE "glossary_terms" (
    "id" UUID NOT NULL,
    "event_id" UUID,
    "term" VARCHAR(80) NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reading" VARCHAR(8) NOT NULL DEFAULT 'auto',
    "spoken" JSONB NOT NULL DEFAULT '{}',
    "translations" JSONB NOT NULL DEFAULT '{}',
    "note" VARCHAR(300),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "glossary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "glossary_terms_event_id_idx" ON "glossary_terms"("event_id");

-- AddForeignKey
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Le sigle piu' comuni della PA italiana, gia' pronte: chi amministra
-- l'istanza le modifica o le cancella. "spell" = lettera per lettera nel
-- doppiaggio, "word" = come una parola; le traduzioni fisse valgono solo
-- per le lingue indicate, nelle altre la sigla resta com'e'.
INSERT INTO "glossary_terms" ("id", "term", "aliases", "reading", "spoken", "translations", "note", "updated_at") VALUES
  (gen_random_uuid(), 'ACN', ARRAY['a ci enne'], 'spell', '{}', '{}', 'Agenzia per la Cybersicurezza Nazionale', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AgID', ARRAY['agid'], 'word', '{}', '{}', 'Agenzia per l''Italia Digitale', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PSN', ARRAY['pi esse enne'], 'spell', '{}', '{}', 'Polo Strategico Nazionale', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PNRR', ARRAY[]::TEXT[], 'spell', '{}', '{}', 'Piano Nazionale di Ripresa e Resilienza', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SPID', ARRAY['spid'], 'word', '{}', '{}', 'Sistema Pubblico di Identità Digitale', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CIE', ARRAY[]::TEXT[], 'spell', '{}', '{}', 'Carta d''Identità Elettronica', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PagoPA', ARRAY['pago pa', 'pagopa'], 'auto', '{"*": "pago P-A"}', '{}', 'Piattaforma dei pagamenti verso la Pubblica Amministrazione', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ANPR', ARRAY[]::TEXT[], 'spell', '{}', '{}', 'Anagrafe Nazionale della Popolazione Residente', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PDND', ARRAY[]::TEXT[], 'spell', '{}', '{}', 'Piattaforma Digitale Nazionale Dati', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CAD', ARRAY[]::TEXT[], 'word', '{}', '{}', 'Codice dell''Amministrazione Digitale', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'INPS', ARRAY[]::TEXT[], 'word', '{}', '{}', 'Istituto Nazionale della Previdenza Sociale', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GDPR', ARRAY[]::TEXT[], 'spell', '{}', '{"de": "DSGVO", "es": "RGPD", "fr": "RGPD", "nl": "AVG", "pl": "RODO", "pt": "RGPD"}', 'Regolamento generale sulla protezione dei dati, (UE) 2016/679', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'IA', ARRAY[]::TEXT[], 'spell', '{}', '{"de": "KI", "en": "AI"}', 'Intelligenza artificiale', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'API', ARRAY[]::TEXT[], 'spell', '{}', '{}', 'Application Programming Interface', CURRENT_TIMESTAMP);
