-- ADR-013 Fase 5 — consenso esplicito separato alla registrazione audio
-- per-partecipante (traccia isolata = PII sensibile). Nullable: null per gli
-- eventi senza multitrack, true richiesto per registrarsi a quelli con.
ALTER TABLE "registrations" ADD COLUMN "consent_multitrack" BOOLEAN;
