-- Il logo dell'ente che porta il servizio, per la fascia «<servizio> e' un
-- progetto di <ente>» del pie' di pagina.
--
-- Solo una colonna nuova, vuota: senza logo il pie' di pagina mostra il solo
-- nome. La versione precedente, che durante l'aggiornamento gira sullo stesso
-- schema, non la vede.

ALTER TABLE "site_settings" ADD COLUMN "organization_logo_url" TEXT;
