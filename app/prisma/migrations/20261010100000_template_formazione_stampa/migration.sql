-- Due scenari in piu' fra i modelli di sistema, completi come gli altri: il
-- corso di formazione (aula virtuale) e la conferenza stampa. Come per gli
-- altri modelli, la registrazione e' disponibile ma non parte da sola; se si
-- registra, dopo l'evento trascrizione, sintesi e traduzioni, con le tracce
-- per partecipante (che chiedono il consenso alla propria traccia).
--
-- Si aggiungono solo se non c'e' gia' un modello con lo stesso nome, e
-- `updated_at` coincide con la creazione: le migrazioni successive li
-- riconoscono come «come spediti», con lo stesso predicato delle precedenti.

INSERT INTO "event_templates" (
  "name", "description", "icon",
  "qa_enabled", "chat_enabled", "agenda_enabled", "word_cloud_enabled", "whiteboard_enabled",
  "recording_enabled", "auto_start_recording",
  "participants_can_unmute", "participants_can_start_video", "participants_can_share_screen",
  "ai_transcript_enabled", "ai_summary_enabled", "ai_translation_enabled", "multitrack_recording_enabled",
  "max_participants", "default_duration_minutes", "post_event_public",
  "is_system", "sort_order", "created_at", "updated_at"
)
SELECT
  'Corso di formazione',
  'Per un''aula virtuale di qualche decina di persone: chi partecipa può intervenire con microfono e webcam, fare domande (Q&A) e rispondere alle domande «In una parola», con l''agenda del corso. La registrazione è disponibile e la avvia chi conduce; se si registra, dopo il corso trascrizione, sintesi e traduzioni. La pagina dopo il corso non è pubblica.',
  'it-file-slides',
  true, true, true, true, false,
  true, false,
  true, true, false,
  true, true, true, true,
  50, 120, false,
  true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Corso di formazione');

INSERT INTO "event_templates" (
  "name", "description", "icon",
  "qa_enabled", "chat_enabled", "agenda_enabled", "word_cloud_enabled", "whiteboard_enabled",
  "recording_enabled", "auto_start_recording",
  "participants_can_unmute", "participants_can_start_video", "participants_can_share_screen",
  "ai_transcript_enabled", "ai_summary_enabled", "ai_translation_enabled", "multitrack_recording_enabled",
  "max_participants", "default_duration_minutes", "post_event_public",
  "is_system", "sort_order", "created_at", "updated_at"
)
SELECT
  'Conferenza stampa',
  'Per presentare una notizia ai giornalisti: relatori in video con la condivisione dello schermo, chi partecipa fa domande per iscritto (Q&A e chat) e chi modera dà la parola. La registrazione è disponibile e la avvia chi modera; se si registra, dopo l''evento trascrizione, sintesi e traduzioni, con la pagina pubblica.',
  'it-horn',
  true, true, false, false, false,
  true, false,
  false, false, false,
  true, true, true, true,
  150, 60, true,
  true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "event_templates" WHERE "name" = 'Conferenza stampa');
