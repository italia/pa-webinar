-- Nella descrizione del modello «Webinar pubblico» la lista degli argomenti
-- si chiama «agenda», come nel resto dell'interfaccia. Si aggiorna solo il
-- testo uguale a quello installato: un modello già modificato a mano resta
-- com'è.

UPDATE "event_templates"
SET "description" = 'Per una grande platea, anche di centinaia di persone: moderatori e relatori in video con la condivisione dello schermo, il pubblico ascolta e partecipa con chat, domande (Q&A), sondaggi e agenda. La registrazione parte da sola; dopo l''evento trascrizione, sintesi e traduzioni, con la pagina pubblica.'
WHERE "description" = 'Per una grande platea, anche di centinaia di persone: moderatori e relatori in video con la condivisione dello schermo, il pubblico ascolta e partecipa con chat, domande (Q&A), sondaggi e scaletta. La registrazione parte da sola; dopo l''evento trascrizione, sintesi e traduzioni, con la pagina pubblica.';
