-- Gli eventi che c'erano prima che la registrazione si separasse dai dati dei
-- partecipanti. A chi si e' iscritto si e' detto che un video non pubblicato si
-- cancella con i loro dati: per questi eventi, finche' il video non e'
-- pubblicato, la registrazione scade al piu' tardi alla conservazione dei dati
-- (data_retention_days dalla fine dell'evento), come prima, e la durata si puo'
-- solo accorciare. Le bozze non hanno raccolto consensi e seguono la regola
-- nuova.
--
-- Solo una colonna nuova e il segno sugli eventi che c'erano: la durata scelta
-- (recording_delete_after_days) resta com'e', cosi' un video pubblicato, ora o
-- dopo, conta come prima dalla pubblicazione. La versione precedente, che
-- durante l'aggiornamento gira sullo stesso schema, non legge la colonna e
-- cancellava gia' il video non pubblicato con i dati.

ALTER TABLE "events" ADD COLUMN "legacy_recording_retention" BOOLEAN NOT NULL DEFAULT false;

UPDATE "events" SET "legacy_recording_retention" = true WHERE "status" <> 'DRAFT';
