/**
 * Predicati di selezione del cleanup GDPR (`/api/cron/cleanup`).
 *
 * Sono stati estratti dall'handler perché quello è il codice che CANCELLA
 * dati di persone, e le sue tre fasi erano verificabili solo a valle di una
 * transazione Prisma: un errore di segno o di confronto qui o cancella troppo
 * (dati persi, irrecuperabili) o troppo poco (violazione della retention
 * dichiarata in `docs/GDPR.md`). Isolati come funzioni pure, i confini della
 * finestra di conservazione si possono asserire uno per uno.
 *
 * L'handler DEVE usare queste funzioni: sono la definizione unica di "cosa è
 * eleggibile alla cancellazione e da quando".
 */

const DAY_MS = 86_400_000;

/**
 * Stati di un evento i cui dati possono entrare nella fase 3 (cancellazione
 * per retention scaduta).
 *
 * Solo eventi FINITI: finché un evento è in corso o deve ancora iniziare, i
 * suoi dati servono al servizio e la finestra di conservazione non è nemmeno
 * cominciata (decorre da `endsAt`).
 *
 * ARCHIVED è nell'elenco insieme a ENDED perché la fase 3 archivia l'evento
 * ma lo lascia in piedi (`docs/GDPR.md`: titolo, descrizione e date restano
 * come riferimento storico): senza ARCHIVED un secondo giro non ripasserebbe
 * più su un evento già archiviato, e tutto ciò che vi è stato scritto DOPO
 * l'archiviazione — o che una versione precedente del cron non cancellava —
 * resterebbe lì per sempre.
 */
export const CLEANABLE_EVENT_STATUSES = ['ENDED', 'ARCHIVED'] as const;

/**
 * Vita della registrazione temporanea non pubblicata: 24 ore
 * (`docs/GDPR.md` → "Flusso registrazione", punto 1). È il video grezzo di
 * Jibri che serve solo ai ritardatari per il catch-up; nessuno lo ha
 * pubblicato, quindi scaduta la finestra non ha più alcuna base per esistere.
 */
export const TEMP_RECORDING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Istante prima del quale una registrazione temporanea è scaduta: si passa
 * come `lt` alla query, così la soglia sta in un posto solo invece che
 * riscritta inline nella `where`.
 */
export function tempRecordingExpiryCutoff(now: Date): Date {
  return new Date(now.getTime() - TEMP_RECORDING_TTL_MS);
}

export interface RecordingRetentionRow {
  /** Quando il moderatore ha pubblicato il video. */
  recordingPublishedAt: Date | null;
  /** Retention scelta per QUESTO video, in giorni. */
  recordingDeleteAfterDays: number | null;
}

/**
 * La registrazione PUBBLICATA ha superato la sua retention (fase 2)?
 *
 * Serve che entrambi i campi ci siano: senza `recordingPublishedAt` non
 * sappiamo da quando contare, e senza `recordingDeleteAfterDays` il video non
 * ha una scadenza propria — segue quella dell'evento (fase 3). In nessuno dei
 * due casi si cancella "per sicurezza": qui l'errore costa un video che la
 * pagina evento sta ancora linkando.
 *
 * Nota su `0`: è trattato come "nessuna scadenza propria", non come "cancella
 * subito". `recordingDeleteAfterDays` è validato `min(1)` (`lib/validation/
 * schemas.ts`), quindi uno 0 non arriva dall'API ma da un default o da una
 * scrittura diretta — e leggerlo come "scaduta all'istante della
 * pubblicazione" farebbe sparire al primo giro di cron ogni video appena
 * pubblicato.
 */
export function isRecordingRetentionExpired(
  evt: RecordingRetentionRow,
  now: Date
): boolean {
  if (!evt.recordingPublishedAt || !evt.recordingDeleteAfterDays) return false;
  const expiresAt =
    evt.recordingPublishedAt.getTime() + evt.recordingDeleteAfterDays * DAY_MS;
  return expiresAt < now.getTime();
}

export interface EventRetentionRow {
  /** Fine dell'evento: la retention decorre da qui, non dalla creazione. */
  endsAt: Date;
  /** `Event.dataRetentionDays`, default 30 (`docs/GDPR.md`). */
  dataRetentionDays: number;
}

/**
 * I dati dei partecipanti di questo evento hanno superato la finestra di
 * conservazione (fase 3)?
 *
 * Il confronto è STRETTO: alla scadenza esatta l'evento non è ancora
 * eleggibile. "Conservati 30 giorni" significa che il trentesimo giorno i dati
 * ci sono ancora; si cancella dopo, non durante.
 */
export function isEventDataRetentionExpired(evt: EventRetentionRow, now: Date): boolean {
  const retentionExpiry = evt.endsAt.getTime() + evt.dataRetentionDays * DAY_MS;
  return retentionExpiry < now.getTime();
}

export interface RecordingBlobRow {
  recordingUrl: string | null;
  recordingPublished: boolean;
}

/**
 * In fase 3, il blob di `recordingUrl` va cancellato insieme al resto?
 *
 * Sì, TRANNE quando il video è pubblicato. `recordingPublished` è l'unico
 * segnale di "documento reso pubblico": la pagina evento e l'indice della
 * videoteca mostrano `recordingUrl` solo se pubblicato, e la sua durata di
 * vita è governata da `recordingDeleteAfterDays` (fase 2). Cancellarlo qui
 * lascerebbe un player linkato su un 404.
 *
 * Da NON estendere a `libraryListed`: una registrazione elencata ma non
 * pubblicata non è visibile da nessuna parte e la fase 2 non la guarda —
 * esentarla qui significherebbe non cancellarne mai il blob.
 */
export function shouldPurgeRecordingBlob(evt: RecordingBlobRow): boolean {
  return Boolean(evt.recordingUrl) && !evt.recordingPublished;
}
