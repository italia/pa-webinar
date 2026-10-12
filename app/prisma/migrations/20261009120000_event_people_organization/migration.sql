-- Persone dell'evento: ente di appartenenza con logo, ruolo di organizzatore
-- e presenza nella pagina pubblica. Additiva: le concessioni esistenti
-- restano moderatori o relatori non pubblicati.
ALTER TABLE "event_moderators" ADD COLUMN "organizer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "event_moderators" ADD COLUMN "organization" TEXT;
ALTER TABLE "event_moderators" ADD COLUMN "organization_logo_url" TEXT;
ALTER TABLE "event_moderators" ADD COLUMN "public_listed" BOOLEAN NOT NULL DEFAULT false;
