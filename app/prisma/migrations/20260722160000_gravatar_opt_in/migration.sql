-- Avatar via Gravatar, come scelta esplicita dell'amministratore (A4).
--
-- Default FALSE di proposito. L'URL Gravatar contiene l'hash dell'email di chi
-- si è iscritto, Jitsi lo diffonde in presenza a tutti i partecipanti della
-- sala, e ogni caricamento è una richiesta a un servizio terzo. Sono
-- conseguenze che l'ente deve poter decidere — e dichiarare nell'informativa —
-- non un comportamento che arriva acceso con un aggiornamento.
ALTER TABLE "site_settings"
  ADD COLUMN "gravatar_enabled" BOOLEAN NOT NULL DEFAULT false;
