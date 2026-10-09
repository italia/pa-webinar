-- L'organizzatore principale (il contatto che riceve il link principale) può
-- comparire nella pagina pubblica come le altre persone dell'evento: con il
-- suo ente e il logo, solo se chi compila lo sceglie.

ALTER TABLE "events" ADD COLUMN "moderator_organization" TEXT;
ALTER TABLE "events" ADD COLUMN "moderator_organization_logo_url" TEXT;
ALTER TABLE "events" ADD COLUMN "moderator_public_listed" BOOLEAN NOT NULL DEFAULT false;
