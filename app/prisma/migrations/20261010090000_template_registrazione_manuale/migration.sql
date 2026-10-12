-- La registrazione non parte mai da sola: la avvia chi conduce con il
-- pulsante REC. Il modello «Webinar pubblico» installato la avviava da solo;
-- ora resta disponibile, e la sua descrizione lo dice. Si tocca solo il
-- modello di sistema mai modificato (`updated_at` entro un secondo da
-- `created_at`, come nelle migrazioni precedenti sui modelli), e
-- `updated_at` non si aggiorna. Gli eventi gia' creati non cambiano.

UPDATE "event_templates"
SET "auto_start_recording" = false,
    "description" = 'Per una grande platea, anche di centinaia di persone: moderatori e relatori in video con la condivisione dello schermo, il pubblico ascolta e partecipa con chat, domande (Q&A), sondaggi e agenda. La registrazione è disponibile e la avvia chi modera; se si registra, dopo l''evento trascrizione, sintesi e traduzioni, con la pagina pubblica.'
WHERE "name" = 'Webinar pubblico'
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second';
