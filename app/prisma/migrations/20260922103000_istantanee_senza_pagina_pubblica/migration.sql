-- Le chiamate istantanee sono usa-e-getta: si aprono dal link e, finita la
-- chiamata, non deve restarne in giro una scheda pubblica. Le nuove nascono
-- con la pagina post-evento spenta; questa riallinea quelle create prima,
-- che avevano ereditato il valore predefinito degli eventi a calendario e
-- quindi restavano negli elenchi, in home, nella sitemap e nel calendario.
--
-- Restano fuori quelle la cui registrazione e' stata pubblicata di proposito
-- in libreria: li' la scheda pubblica e' la destinazione del link, e
-- spegnerla porterebbe a un 404 una pagina gia' condivisa.
UPDATE "events"
SET "post_event_public" = false
WHERE "event_type" = 'INSTANT'
  AND "library_listed" = false;
