-- Lingua della pagina da cui ci si e' iscritti, per le email successive.
ALTER TABLE "registrations" ADD COLUMN "locale" VARCHAR(5);
