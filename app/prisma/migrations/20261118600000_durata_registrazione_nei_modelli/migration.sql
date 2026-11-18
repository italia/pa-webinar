-- La durata della registrazione che un modello propone agli eventi che crea
-- (Event.recording_delete_after_days): la registrazione non segue la
-- conservazione dei dati dei partecipanti, e senza una durata resta finche'
-- qualcuno non la cancella.
--
-- Solo una colonna nuova, vuota: nessuna durata, come prima. La versione
-- precedente, che durante l'aggiornamento gira sullo stesso schema, non la vede.

ALTER TABLE "event_templates" ADD COLUMN "recording_delete_after_days" INTEGER;
