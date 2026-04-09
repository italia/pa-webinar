-- CreateTable (idempotent — skips if already exists via db push)
CREATE TABLE IF NOT EXISTS "event_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'it-video',
    "qa_enabled" BOOLEAN NOT NULL DEFAULT true,
    "chat_enabled" BOOLEAN NOT NULL DEFAULT false,
    "recording_enabled" BOOLEAN NOT NULL DEFAULT false,
    "participants_can_unmute" BOOLEAN NOT NULL DEFAULT false,
    "participants_can_start_video" BOOLEAN NOT NULL DEFAULT false,
    "participants_can_share_screen" BOOLEAN NOT NULL DEFAULT false,
    "max_participants" INTEGER NOT NULL DEFAULT 300,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_templates_pkey" PRIMARY KEY ("id")
);

-- InsertDefaults: only insert each system template if not already present (by name)
INSERT INTO "event_templates" ("name", "description", "icon", "qa_enabled", "chat_enabled", "recording_enabled", "participants_can_unmute", "participants_can_start_video", "participants_can_share_screen", "max_participants", "is_system", "sort_order", "updated_at")
SELECT 'Webinar', 'Presentazione pubblica con molti partecipanti. Solo ascolto, Q&A attivo, nessuna webcam partecipanti.', 'it-presentation', true, false, false, false, false, false, 300, true, 0, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Webinar' AND "is_system" = true);

INSERT INTO "event_templates" ("name", "description", "icon", "qa_enabled", "chat_enabled", "recording_enabled", "participants_can_unmute", "participants_can_start_video", "participants_can_share_screen", "max_participants", "is_system", "sort_order", "updated_at")
SELECT 'Community interattiva', 'Evento partecipativo con chat, Q&A e possibilità per tutti di parlare e mostrare la webcam.', 'it-team-digitale', true, true, false, true, true, false, 50, true, 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Community interattiva' AND "is_system" = true);

INSERT INTO "event_templates" ("name", "description", "icon", "qa_enabled", "chat_enabled", "recording_enabled", "participants_can_unmute", "participants_can_start_video", "participants_can_share_screen", "max_participants", "is_system", "sort_order", "updated_at")
SELECT 'Videocall tra colleghi', 'Riunione interna con pochi partecipanti. Tutti possono parlare, condividere schermo e usare la webcam.', 'it-video', false, true, false, true, true, true, 20, true, 2, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Videocall tra colleghi' AND "is_system" = true);

INSERT INTO "event_templates" ("name", "description", "icon", "qa_enabled", "chat_enabled", "recording_enabled", "participants_can_unmute", "participants_can_start_video", "participants_can_share_screen", "max_participants", "is_system", "sort_order", "updated_at")
SELECT 'Presentazione pubblica', 'Evento pubblico con registrazione video e condivisione schermo del relatore. Q&A attivo.', 'it-camera', true, false, true, false, false, false, 300, true, 3, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Presentazione pubblica' AND "is_system" = true);
