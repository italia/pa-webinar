-- Da quando, al piu' presto, conta la durata della registrazione non
-- pubblicata (events.recording_delete_after_days): l'ultima volta che chi
-- organizza ha scelto la durata, ha tolto la pubblicazione o ha agganciato un
-- file nuovo. Senza, la durata conta dalla fine dell'evento.
--
-- Una colonna nuova, e un valore solo dove serve: una durata gia' scelta su un
-- video non pubblicato valeva dalla pubblicazione, e da qui conta da adesso,
-- non da una fine dell'evento magari lontana, che cancellerebbe il video al
-- primo giro della pulizia. La versione precedente, che durante
-- l'aggiornamento gira sullo stesso schema, non legge la colonna.

ALTER TABLE "events" ADD COLUMN "recording_retention_from" TIMESTAMP(3);

UPDATE "events" SET "recording_retention_from" = CURRENT_TIMESTAMP
WHERE "recording_delete_after_days" IS NOT NULL AND "recording_published" = false;
