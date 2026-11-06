-- Le voci di rubrica conservano l'email e contano i mesi dal consenso.
-- Solo dati: colonne e indice nascono con 20261105200000_consensi_per_formato.

-- L'email di ogni voce ancora in rubrica viene dall'iscrizione piu' recente con
-- la stessa impronta. Si copia il cifrato cosi' com'e': nessuna chiave serve qui.
-- Una voce senza iscrizioni resta senza email, e fuori dal selettore fino a una
-- nuova spunta. Chi ha ritirato il consenso non si riempie.
UPDATE "persons" AS p
SET "email" = ultima."email"
FROM (
  SELECT DISTINCT ON ("email_hash") "email_hash", "email"
  FROM "registrations"
  ORDER BY "email_hash", "created_at" DESC
) AS ultima
WHERE p."email_hash" = ultima."email_hash"
  AND p."opted_in_to_address_book" = true
  AND p."email" IS NULL;

-- La conservazione parte da `opted_in_at`: una voce in rubrica senza quella data
-- non scadrebbe mai. L'ultima attivita' e' la data piu' vicina al consenso.
UPDATE "persons"
SET "opted_in_at" = "last_active_at"
WHERE "opted_in_to_address_book" = true
  AND "opted_in_at" IS NULL;
