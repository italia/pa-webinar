-- Il nickname scelto da chi si e' iscritto (lib/live/nickname), cifrato come
-- il nome, con la sua impronta per l'evento: due iscritti non hanno lo stesso.
--
-- Solo colonne nuove, vuote: la versione precedente, che durante
-- l'aggiornamento gira sullo stesso schema, non le vede. L'indice unico non
-- tocca le righe senza nickname (null).

ALTER TABLE "registrations" ADD COLUMN "nickname" TEXT,
ADD COLUMN "nickname_key" VARCHAR(64);

CREATE UNIQUE INDEX "registrations_event_id_nickname_key_key" ON "registrations"("event_id", "nickname_key");
