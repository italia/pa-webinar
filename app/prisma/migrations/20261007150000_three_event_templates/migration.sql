-- Tre template di sistema chiari al posto di sei in parte sovrapposti, con
-- descrizioni coerenti con le impostazioni che applicano.
--
-- Prima: «Webinar», «Presentazione pubblica», «Community interattiva»,
-- «Evento interattivo completo», «Videocall tra colleghi» ed «Evento
-- partecipativo». Tre erano quasi uguali, due descrizioni promettevano la Q&A
-- che 20260721150000 aveva spento, e due usavano come icona il marchio di un
-- ente.
--
-- Si toccano solo i template mai modificati, con lo stesso predicato di
-- 20260721150000 (`updated_at` entro un secondo da `created_at`): quelli che
-- un'amministrazione ha cambiato restano come sono. `updated_at` non si
-- aggiorna, cosi' le migrazioni successive li riconoscono ancora come «come
-- spediti». Nessun evento punta a un template: eliminarne uno non tocca gli
-- eventi gia' creati.

-- Il template decide anche se la pagina dopo l'evento e' pubblica: una
-- riunione di lavoro non deve esserlo.
ALTER TABLE "event_templates" ADD COLUMN "post_event_public" BOOLEAN NOT NULL DEFAULT true;

-- 1. Webinar pubblico (era «Webinar»).
UPDATE "event_templates"
SET "name" = 'Webinar pubblico',
    "description" = 'Relatori in video e pubblico in ascolto, con la chat. La registrazione è disponibile e si avvia in sala. Fino a 300 partecipanti, un''ora.',
    "icon" = 'it-presentation',
    "sort_order" = 0,
    "qa_enabled" = false,
    "chat_enabled" = true,
    "recording_enabled" = true,
    "auto_start_recording" = false,
    "agenda_enabled" = false,
    "word_cloud_enabled" = false,
    "whiteboard_enabled" = false,
    "participants_can_unmute" = false,
    "participants_can_start_video" = false,
    "participants_can_share_screen" = false,
    "max_participants" = 300,
    "default_duration_minutes" = 60,
    "permission_matrix" = NULL,
    "post_event_public" = true
WHERE "name" = 'Webinar'
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second'
  AND NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Webinar pubblico');

-- 2. Riunione di lavoro (era «Videocall tra colleghi»).
UPDATE "event_templates"
SET "name" = 'Riunione di lavoro',
    "description" = 'Tutti possono parlare, usare la webcam e condividere lo schermo. Senza registrazione, e la pagina dopo l''evento non è pubblica. Fino a 20 partecipanti, un''ora.',
    "icon" = 'it-video',
    "sort_order" = 1,
    "qa_enabled" = false,
    "chat_enabled" = true,
    "recording_enabled" = false,
    "auto_start_recording" = false,
    "agenda_enabled" = false,
    "word_cloud_enabled" = false,
    "whiteboard_enabled" = false,
    "participants_can_unmute" = true,
    "participants_can_start_video" = true,
    "participants_can_share_screen" = true,
    "max_participants" = 20,
    "default_duration_minutes" = 60,
    "permission_matrix" = NULL,
    "post_event_public" = false
WHERE "name" = 'Videocall tra colleghi'
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second'
  AND NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Riunione di lavoro');

-- 3. Evento partecipativo (era «Community interattiva»). Il template non di
-- sistema con lo stesso nome, inserito da 20260611200000 e mai modificato,
-- era la stessa idea: lascia il posto a questo, ma solo se la conversione qui
-- sotto avviene (altrimenti l'istanza resterebbe senza nessuno dei due).
DELETE FROM "event_templates"
WHERE "name" = 'Evento partecipativo'
  AND "is_system" = false
  AND "updated_at" <= "created_at" + interval '1 second'
  AND EXISTS (
    SELECT 1 FROM "event_templates"
    WHERE "name" = 'Community interattiva'
      AND "is_system" = true
      AND "updated_at" <= "created_at" + interval '1 second'
  );

UPDATE "event_templates"
SET "name" = 'Evento partecipativo',
    "description" = 'Tutti possono parlare e usare la webcam; lo schermo lo condividono i relatori. Con la scaletta dell''incontro e le domande «In una parola». Fino a 50 partecipanti, un''ora e mezza.',
    "icon" = 'it-comment',
    "sort_order" = 2,
    "qa_enabled" = false,
    "chat_enabled" = true,
    "recording_enabled" = false,
    "auto_start_recording" = false,
    "agenda_enabled" = true,
    "word_cloud_enabled" = true,
    "whiteboard_enabled" = false,
    "participants_can_unmute" = true,
    "participants_can_start_video" = true,
    "participants_can_share_screen" = false,
    "max_participants" = 50,
    "default_duration_minutes" = 90,
    "permission_matrix" = NULL,
    "post_event_public" = true
WHERE "name" = 'Community interattiva'
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second'
  AND NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Evento partecipativo');

-- 4. I template di sistema rimasti, se mai modificati: i loro casi li coprono
-- i tre qui sopra.
DELETE FROM "event_templates"
WHERE "name" IN ('Evento interattivo completo', 'Presentazione pubblica', 'Community interattiva')
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second';

-- 5. La conservazione suggerita da un template si allinea al massimo di un
-- evento (365 giorni): un valore piu' alto renderebbe impossibile salvare gli
-- eventi nati da quel template. Vale anche per i template modificati, perche'
-- e' il loro valore a essere fuori misura.
UPDATE "event_templates" SET "default_retention_days" = 365 WHERE "default_retention_days" > 365;
