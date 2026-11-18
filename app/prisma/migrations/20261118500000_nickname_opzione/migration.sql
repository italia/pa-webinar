-- L'opzione del nickname per chi partecipa, sull'evento e sul modello
-- (lib/live/nickname).
--
-- Solo colonne nuove, spente: la versione precedente, che durante
-- l'aggiornamento gira sullo stesso schema, non le vede. Gli eventi che ci
-- sono gia' restano senza nickname.

ALTER TABLE "events" ADD COLUMN "nicknames_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "event_templates" ADD COLUMN "nicknames_enabled" BOOLEAN NOT NULL DEFAULT false;
