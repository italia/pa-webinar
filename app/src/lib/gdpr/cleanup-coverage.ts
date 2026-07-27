/**
 * Cosa la pulizia periodica deve fare di OGNI tabella legata a un evento.
 *
 * PERCHÉ ESISTE. La transazione di `/api/cron/cleanup` è un elenco scritto a
 * mano. Aggiungere un modello con `eventId` e dimenticarlo lì non rompe niente:
 * la chiave esterna è `onDelete: Cascade`, ma l'evento non viene mai cancellato
 * davvero — resta `ARCHIVED` come riferimento storico — quindi la cascata non
 * scatta e i dati sopravvivono alla conservazione dichiarata. È già successo
 * due volte, con la chat e con le concessioni nominali.
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
  Question: 'domande poste durante l’evento',
  Poll: 'sondaggi e voti di quell’occorrenza',
  ChatMessage: 'nomi dei mittenti e testi, allegati compresi',
  Reaction: 'reazioni di quell’occorrenza',
  EventFeedback: 'giudizi dei partecipanti',
  WordCloudRound: 'parole proposte da chi c’era',
  EventMaterial: 'materiali caricati per quell’occorrenza',
  EventAgendaItem: 'scaletta e reazioni collegate',
  EventReminder: 'promemoria programmati e loro invii',
  EventInvitation: 'nome, email cifrata, HMAC e token del link di registrazione precompilata',
  EventModerator: 'concessioni nominali: nome ed email cifrati piu’ un link di accesso durevole',
  CallSession: 'ripulita, non cancellata: si azzerano le colonne con PII e restano i numeri aggregati',
};

/**
 * Tabelle la cui RIGA non viene toccata, con il motivo. Attenzione a due casi:
 * di questionari e registrazioni la transazione cancella i figli con i dati
 * personali (risposte e tracce audio), non la riga che li possiede.
 */
export const NOT_PURGED_BY_CLEANUP: Record<string, string> = {
  EventOrganizer: 'enti organizzatori: dati istituzionali pubblici, non personali, e restano leggibili sull’evento archiviato',
  EventTagLink: 'legame con una parola chiave: nessun dato personale',
  GdprAuditLog: 'è il registro delle cancellazioni: cancellarlo distruggerebbe la prova di averle fatte',
  EventQuestionnaire: 'resta la configurazione, che non è un dato personale; le RISPOSTE, con nome e hash dell’email di chi ha risposto, vengono cancellate passando dal questionario',
  Recording: 'l’albero della registrazione segue la propria retention (può essere più lunga); di suo la transazione cancella le tracce per-partecipante già purgate, che portano il nome cifrato',
};
