-- Il catalogo degli eventi, per le statistiche dell'istanza: il modello da cui
-- un evento e' nato (con il suo nome di allora, che resta se il modello cambia
-- nome o si cancella) e la famiglia del formato scelto nel wizard.
--
-- Solo colonne nuove, vuote: la versione precedente, che durante
-- l'aggiornamento gira sullo stesso schema, non le vede. Gli eventi che ci sono
-- gia' restano «non catalogati»: nessuno sa da quale modello o formato sono
-- nati, e il catalogo non lo indovina. Le chiamate rapide sono un tipo a se'
-- (event_type INSTANT).

CREATE TYPE "event_format_class" AS ENUM ('MEETING', 'PARTICIPATORY', 'PUBLIC');

ALTER TABLE "events" ADD COLUMN "format_class" "event_format_class",
ADD COLUMN "template_id" UUID,
ADD COLUMN "template_name" TEXT;

-- «Quanti eventi usano questo modello», e la cancellazione del modello.
CREATE INDEX "events_template_id_idx" ON "events"("template_id");

-- Cancellare un modello non tocca gli eventi: perdono il riferimento, il nome resta.
ALTER TABLE "events" ADD CONSTRAINT "events_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "event_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
