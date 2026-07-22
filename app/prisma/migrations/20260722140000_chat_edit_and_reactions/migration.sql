-- Chat: correggere un messaggio e reagire a un messaggio (feedback 22 lug).
--
-- A6: "non posso modificare il messaggio se ho fatto degli errori". `edited_at`
-- null = mai modificato, così la UI può dire "modificato" senza indovinare.
ALTER TABLE "chat_messages" ADD COLUMN "edited_at" TIMESTAMP(3);

-- A3: "aggiungere vicino all'iconcina rispondi anche un'icona che apre le emoji
-- perché ad oggi non si riesce fare reazioni ai singoli messaggi". Non era un
-- bug di visualizzazione: la funzione non esisteva.
--
-- Una riga per (messaggio, autore, emoji): l'unique rende il toggle idempotente
-- sotto doppio click o doppio invio, e impedisce che lo stesso utente conti due
-- volte la stessa emoji.
CREATE TABLE "chat_message_reactions" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL,
  "sender_id"  TEXT NOT NULL,
  "emoji"      VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_message_reactions_message_id_sender_id_emoji_key"
  ON "chat_message_reactions" ("message_id", "sender_id", "emoji");
CREATE INDEX "chat_message_reactions_message_id_idx"
  ON "chat_message_reactions" ("message_id");

-- La cancellazione a cascata segue il messaggio: quando la retention cancella la
-- chat, le reazioni se ne vanno con essa (sono comunque dati di partecipazione).
ALTER TABLE "chat_message_reactions"
  ADD CONSTRAINT "chat_message_reactions_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
