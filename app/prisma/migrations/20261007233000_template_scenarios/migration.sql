-- I tre template di sistema tarati sugli scenari tipici, invece che su un
-- numero massimo di partecipanti (che non e' un tetto: serve solo a
-- dimensionare il bridge, e le iscrizioni oltre la stima sono accettate).
--
-- - Webinar pubblico: grande platea. Moderatori e relatori in video, il
--   pubblico ascolta e partecipa con chat, Q&A, sondaggi e scaletta. La
--   registrazione parte da sola, e dopo l'evento trascrizione, sintesi e
--   traduzioni, con la pagina pubblica.
-- - Evento partecipativo: incontro aperto di un centinaio di persone, in cui
--   tutti parlano, usano la webcam e condividono lo schermo. Registrazione
--   disponibile, la avvia chi modera; elaborazione dopo l'evento se si
--   registra.
-- - Riunione di lavoro: piccolo gruppo, invariato salvo la descrizione.
--
-- Come le migrazioni precedenti sui template, si toccano solo i template di
-- sistema mai modificati (`updated_at` entro un secondo da `created_at`), e
-- `updated_at` non si aggiorna. Dove si registra la multitraccia e' accesa
-- per default: le tracce per partecipante dicono chi parla nella
-- trascrizione. Con la multitraccia accesa il consenso alla propria traccia
-- e' richiesto per iscriversi e per entrare in sala. La matrice dei permessi
-- torna NULL, come nella migrazione precedente: il wizard la preferisce ai
-- singoli permessi, che qui cambiano.
--
-- Il numero di partecipanti e' una stima per dimensionare il bridge: 300 per
-- la grande platea (pubblico senza video) e' il massimo che resta su un solo
-- bridge con le costanti di dimensionamento predefinite (lib/jvb-sizing.ts),
-- e 100 per l'incontro aperto vi resta con margine; numeri piu' alti, o il
-- video del pubblico, fanno chiedere un secondo bridge.

UPDATE "event_templates"
SET "description" = 'Per una grande platea, anche di centinaia di persone: moderatori e relatori in video con la condivisione dello schermo, il pubblico ascolta e partecipa con chat, domande (Q&A), sondaggi e scaletta. La registrazione parte da sola; dopo l''evento trascrizione, sintesi e traduzioni, con la pagina pubblica.',
    "qa_enabled" = true,
    "chat_enabled" = true,
    "agenda_enabled" = true,
    "word_cloud_enabled" = false,
    "recording_enabled" = true,
    "auto_start_recording" = true,
    "participants_can_unmute" = false,
    "participants_can_start_video" = false,
    "participants_can_share_screen" = false,
    "ai_transcript_enabled" = true,
    "ai_summary_enabled" = true,
    "ai_translation_enabled" = true,
    "multitrack_recording_enabled" = true,
    "max_participants" = 300,
    "default_duration_minutes" = 90,
    "post_event_public" = true,
    "permission_matrix" = NULL
WHERE "name" = 'Webinar pubblico'
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second';

UPDATE "event_templates"
SET "description" = 'Per un incontro aperto di un centinaio di persone: tutti possono parlare, usare la webcam e condividere lo schermo, con la chat e le domande «In una parola». La registrazione è disponibile e la avvia chi modera; se si registra, dopo l''evento trascrizione, sintesi e traduzioni.',
    "qa_enabled" = false,
    "chat_enabled" = true,
    "agenda_enabled" = false,
    "word_cloud_enabled" = true,
    "recording_enabled" = true,
    "auto_start_recording" = false,
    "participants_can_unmute" = true,
    "participants_can_start_video" = true,
    "participants_can_share_screen" = true,
    "ai_transcript_enabled" = true,
    "ai_summary_enabled" = true,
    "ai_translation_enabled" = true,
    "multitrack_recording_enabled" = true,
    "max_participants" = 100,
    "default_duration_minutes" = 60,
    "post_event_public" = true,
    "permission_matrix" = NULL
WHERE "name" = 'Evento partecipativo'
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second';

UPDATE "event_templates"
SET "description" = 'Per un piccolo gruppo: tutti possono parlare, usare la webcam e condividere lo schermo, con la chat. Senza registrazione; la pagina dopo l''evento non è pubblica.'
WHERE "name" = 'Riunione di lavoro'
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second';
