-- Aggiunge la colonna agenda_enabled ai template (un template può pre-attivare
-- la checklist/note live) e inserisce un template "tutto attivo" pensato per
-- eventi partecipativi (50-150 persone, pochi relatori per volta).

-- AlterTable
ALTER TABLE "event_templates" ADD COLUMN "agenda_enabled" BOOLEAN NOT NULL DEFAULT false;

-- InsertTemplate: "Evento partecipativo" — non di sistema (is_system = false →
-- eliminabile dall'admin). Tutti possono parlare/webcam/screenshare; chat, Q&A,
-- note/agenda attivi; registrazione facoltativa avviata dal moderatore
-- (recording_enabled = true, auto_start_recording resta false di default).
INSERT INTO "event_templates" ("name", "description", "icon", "qa_enabled", "chat_enabled", "recording_enabled", "agenda_enabled", "participants_can_unmute", "participants_can_start_video", "participants_can_share_screen", "max_participants", "is_system", "sort_order", "updated_at")
SELECT 'Evento partecipativo', 'Tutti possono parlare, attivare la webcam e condividere lo schermo. Chat, Q&A, sondaggi, note/agenda e materiali attivi. La registrazione è facoltativa e viene avviata dal moderatore. Pensato per 50-150 partecipanti, con pochi relatori per volta.', 'it-team-digitale', true, true, true, true, true, true, true, 150, false, 10, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Evento partecipativo');
