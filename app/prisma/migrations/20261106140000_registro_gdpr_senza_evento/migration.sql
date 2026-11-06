-- Una riga del registro GDPR puo' non riguardare un evento: il ritiro di una voce
-- di rubrica senza iscrizioni. La cancellazione a cascata con l'evento non cambia.
ALTER TABLE "gdpr_audit_logs" ALTER COLUMN "event_id" DROP NOT NULL;
