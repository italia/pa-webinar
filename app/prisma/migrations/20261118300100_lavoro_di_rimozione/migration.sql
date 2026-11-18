-- Il lavoro che toglie una persona da un video (REDACT): il worker senza GPU
-- copre gli intervalli scelti con un cartello muto. Solo aggiunte: la release
-- precedente non accoda ne' prende lavori di questo tipo.

-- AlterEnum
ALTER TYPE "PostprodJobKind" ADD VALUE 'REDACT';

-- Un solo proprietario per lavoro: la registrazione, o l'evento per il
-- resoconto, la traduzione dei testi e la rimozione (che porta la
-- registrazione nel payload e si chiude solo con la consegna). Il tipo si
-- confronta come testo: REDACT, aggiunto in questa stessa migrazione, non si
-- puo' ancora usare come enum. Le righe esistenti rispettano gia' la regola
-- nuova, che allarga quella di prima.
ALTER TABLE "postprod_jobs" DROP CONSTRAINT "postprod_jobs_un_proprietario";
ALTER TABLE "postprod_jobs" ADD CONSTRAINT "postprod_jobs_un_proprietario"
  CHECK ((recording_id IS NULL) <> (event_id IS NULL) AND ((event_id IS NOT NULL) = (kind::text IN ('REPORT', 'TRANSLATE_TEXT', 'REDACT'))));
