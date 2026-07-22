-- Avatar via Gravatar, scelta esplicita dell'amministratore (A4).
--
-- Default FALSE. Anche passando dal nostro proxy `/api/avatar` — così il
-- browser dei partecipanti non contatta mai gravatar.com — resta una richiesta
-- della piattaforma a un servizio terzo, che l'ente deve poter decidere e
-- dichiarare nell'informativa. Non è un comportamento che arriva acceso con un
-- aggiornamento.
ALTER TABLE "site_settings"
  ADD COLUMN "gravatar_enabled" BOOLEAN NOT NULL DEFAULT false;
