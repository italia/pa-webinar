/**
 * Cosa la pulizia periodica deve fare di OGNI tabella legata a un evento.
 *
 * PERCHÉ ESISTE. La transazione di `/api/cron/cleanup` è un elenco scritto a
 * mano. Aggiungere un modello con `eventId` e dimenticarlo lì non rompe niente:
 * la chiave esterna è `onDelete: Cascade`, ma l'evento non viene cancellato
 * dalla pulizia — resta, con i suoi contenuti anonimi, finché qualcuno non lo
 * elimina — quindi la cascata non scatta e i dati sopravvivono alla
 * conservazione dichiarata. È già successo due volte, con la chat e con le
 * concessioni nominali.
 *
 * Qui ogni tabella è classificata una volta sola, e un test verifica contro lo
 * schema di Prisma che non ne manchi nessuna: se ne aggiungi una e non decidi
 * cosa farne, fallisce la suite invece della prossima scadenza.
 *
 * Classificare NON basta a cancellare: il test verifica anche che ciò che è
 * dichiarato purgato compaia davvero nella transazione.
 */

/** Tabelle che la transazione svuota (o ripulisce) alla scadenza. */
export const PURGED_BY_CLEANUP: Record<string, string> = {
  Registration: 'iscritti: email cifrata, nome, hash, token di accesso',
  Question: 'anonimizzate, non cancellate: restano testo, risposta e voti contati; si tolgono nome dell’autore e iscrizione (prima di cancellare le iscrizioni, che le porterebbero via in cascata)',
  ChatMessage: 'nomi dei mittenti e testi, allegati compresi',
  Reaction: 'reazioni di quell’occorrenza',
  EventMaterial: 'anonimizzati, non cancellati: il materiale e il suo file restano con l’evento, si toglie il nome di chi l’ha aggiunto; il file se ne va quando si cancella l’evento',
  EventReminder: 'promemoria programmati e loro invii',
  EventInvitation: 'nome, email cifrata, HMAC e token del link di registrazione precompilata',
  EventModerator: 'concessioni nominali: nome ed email cifrati piu’ un link di accesso durevole',
  MultitrackConsent: 'prova del consenso alla registrazione per partecipante: nome cifrato e posto nella conferenza',
  CallSession: 'ripulita, non cancellata: si azzerano le colonne con PII e restano i numeri aggregati',
};

/**
 * Tabelle la cui RIGA non viene toccata, con il motivo. Attenzione a due casi:
 * di questionari e registrazioni la transazione cancella i figli con i dati
 * personali (risposte e tracce audio), non la riga che li possiede.
 */
export const NOT_PURGED_BY_CLEANUP: Record<string, string> = {
  Poll: 'contenuto dell’evento: domanda, opzioni e voti restano; i voti perdono iscrizione e identificativo del browser (UPDATE di poll_votes nella transazione)',
  EventFeedback: 'valutazioni a stelle e commenti restano senza identità: iscrizione e identificativo del browser si tolgono (UPDATE di event_feedback nella transazione)',
  WordCloudRound: 'contenuto dell’evento: le parole restano, senza iscrizione né identificativo del browser (UPDATE di word_cloud_submissions nella transazione)',
  EventAgendaItem: 'l’agenda è contenuto dell’evento, senza dati personali; le reazioni delle persone agli argomenti si cancellano',
  LiveAction: 'cronologia della sala senza nomi (titoli, risultati, ore delle azioni): contenuto dell’evento, serve anche alla post-produzione',
  EventOrganizer: 'enti organizzatori: dati istituzionali pubblici, non personali, e restano leggibili sull’evento anche dopo la conservazione dei dati',
  EventTagLink: 'legame con una parola chiave: nessun dato personale',
  GlossaryTerm: 'glossario della post-produzione (sigle, termini, pronunce): configurazione dell’evento scritta da chi lo organizza, non dati delle persone che partecipano',
  GdprAuditLog: 'è il registro delle cancellazioni: cancellarlo distruggerebbe la prova di averle fatte',
  EventQuestionnaire: 'resta la configurazione, che non è un dato personale; le risposte di fine evento restano senza nome, hash dell’email e identità, quelle chieste all’iscrizione si cancellano passando dal questionario',
  Recording: 'l’albero della registrazione segue la propria retention (può essere più lunga); di suo la transazione cancella le tracce per-partecipante già purgate, che portano il nome cifrato',
  PostprodOriginalBody: 'il testo come l’ha prodotto la macchina, conservato accanto alla versione rivista: segue l’artefatto da cui è copiato e la retention della registrazione, che lo cancella insieme al resto (cron di post-produzione + cascade). Cancellarlo qui, alla scadenza dell’evento, separerebbe le due versioni di un verbale che deve restare confrontabile',
};
