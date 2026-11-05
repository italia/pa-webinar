-- Qualcuno ha parlato senza consenso alla registrazione: la pagina dell'evento lo dice.
ALTER TABLE "events" ADD COLUMN "unrecorded_speech" BOOLEAN NOT NULL DEFAULT false;

-- Il segno viene dal token, tramite Prosody: non dal browser della persona.
ALTER TABLE "room_occupants" ADD COLUMN "voice_excluded" BOOLEAN NOT NULL DEFAULT false;
