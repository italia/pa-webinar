// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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
import type { TipoConsenso } from '@/lib/gdpr/consent-proofs';

const DAY_MS = 86_400_000;

/**
 * Stati di un evento i cui dati possono entrare nella fase 3 (cancellazione
 * per retention scaduta).
 *
 * Solo eventi FINITI: finché un evento è in corso o deve ancora iniziare, i
 * suoi dati servono al servizio e la finestra di conservazione non è nemmeno
 * cominciata (decorre da `endsAt`).
 *
 * ARCHIVED è nell'elenco insieme a ENDED perché un evento si può archiviare a
 * mano prima che la sua conservazione scada, e i suoi dati personali vanno
 * tolti lo stesso. La fase 3 ripassa ogni giorno sugli eventi oltre la
 * conservazione (è idempotente): toglie anche ciò che vi si fosse scritto dopo
 * il primo giro, o che un giro fallito avesse lasciato. Restano i contenuti,
 * senza identità.
 */
export const CLEANABLE_EVENT_STATUSES = ['ENDED', 'ARCHIVED'] as const;

/**
 * Stati di un evento che non risulta concluso ma a cui la finestra di
 * conservazione si applica lo stesso (fase 3).
 *
 * La retention decorre dalla fine dell'evento, non dal suo stato: un evento
 * rimasto PUBLISHED o LIVE settimane dopo la fine — nessuno lo ha chiuso, il
 * conduttore del ciclo di vita era fermo — è finito a ogni effetto, e
 * l'informativa promette la cancellazione comunque. Il cron lo archivia e lo
 * ripulisce nello stesso giro.
 *
 * DRAFT è escluso di proposito: una bozza non ha mai raccolto iscrizioni, e la
 * sua configurazione (agenda, relatori, promemoria) è ciò che una copia
 * eredita — ripulirla la svuoterebbe per chi la tiene come modello.
 */
export const UNFINISHED_EVENT_STATUSES = ['PUBLISHED', 'PROVISIONING', 'IDLE', 'LIVE'] as const;

/**
 * Vita della registrazione temporanea non pubblicata: 24 ore
 * (`docs/GDPR.md` → "The daily GDPR cleanup", fase 1). È un video grezzo che
 * la sala d'attesa offre ai ritardatari per il catch-up; nessun flusso
 * integrato lo crea (arriva solo dall'API di modifica dell'evento) e nessuno
 * lo ha pubblicato, quindi scaduta la finestra non ha più alcuna base per
 * esistere.
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

export interface CleanupCandidateRow extends EventRetentionRow {
  status: string;
  /** Ultimo segno di vita della sala (resoconti dei client, bridge). */
  lastActiveAt: Date | null;
}

/** L'evento risulta concluso (ENDED o ARCHIVED). */
export function isFinishedEventStatus(status: string): boolean {
  return (CLEANABLE_EVENT_STATUSES as readonly string[]).includes(status);
}

/**
 * Da quando contano le scadenze dell'evento: quella dei dati dei partecipanti e
 * quella della registrazione non pubblicata. Per un evento concluso la fine
 * prevista (`endsAt`); per uno mai concluso (UNFINISHED_EVENT_STATUSES) il piu'
 * tardo fra la fine prevista e l'ultima attivita', cosi' una sala a tempo
 * indefinito ancora usata dopo la fine programmata non si svuota mentre
 * qualcuno ci sta. Una bozza non ha scadenze: null.
 */
export function inizioConservazione(evt: CleanupCandidateRow): Date | null {
  if (isFinishedEventStatus(evt.status)) return evt.endsAt;
  if (!(UNFINISHED_EVENT_STATUSES as readonly string[]).includes(evt.status)) return null;
  return new Date(Math.max(evt.endsAt.getTime(), evt.lastActiveAt?.getTime() ?? 0));
}

/**
 * I dati di questo evento vanno cancellati in questo giro (fase 3)? La finestra
 * decorre da `inizioConservazione`; una bozza, mai.
 */
export function isEventEligibleForCleanup(evt: CleanupCandidateRow, now: Date): boolean {
  const inizio = inizioConservazione(evt);
  return (
    inizio !== null &&
    isEventDataRetentionExpired({ endsAt: inizio, dataRetentionDays: evt.dataRetentionDays }, now)
  );
}

export interface RecordingRetentionRow extends CleanupCandidateRow {
  recordingPublished: boolean;
  /** Quando chi organizza ha pubblicato il video. */
  recordingPublishedAt: Date | null;
  /** La scadenza della registrazione dell'evento, in giorni; null = nessuna. */
  recordingDeleteAfterDays: number | null;
  /** Da quando, al piu' presto, conta la scadenza della registrazione non
   *  pubblicata: l'ultima scelta della durata, l'ultima pubblicazione tolta,
   *  l'ultimo file agganciato. Null = dalla fine dell'evento. */
  recordingRetentionFrom: Date | null;
}

/**
 * Quando scade la registrazione dell'evento (fase 2), o null se non scade.
 *
 * La registrazione e' un documento storico: non segue la conservazione dei dati
 * dei partecipanti, e senza `recordingDeleteAfterDays` resta finche' qualcuno
 * non la cancella. Con una durata, i giorni contano:
 *  - dalla pubblicazione, finche' il video e' pubblicato (come prima: la
 *    pubblicazione riapre il conto);
 *  - altrimenti dalla fine dell'evento, la stessa da cui conta la conservazione
 *    dei dati (`inizioConservazione`), ma mai da prima di
 *    `recordingRetentionFrom`: scegliere la durata, togliere la pubblicazione
 *    (anche togliendo il video pubblicato) o agganciare un file nuovo a eventi
 *    finiti da tempo non cancella la registrazione, o cio' che ne resta, al
 *    giro dopo, e un file caricato dopo la scadenza non se ne va prima che
 *    qualcuno lo veda.
 *
 * Un video pubblicato senza la data di pubblicazione (scritto direttamente nel
 * database) non scade: non sappiamo da quando contare, e qui l'errore costa un
 * video che la pagina evento sta ancora linkando. Una bozza non scade mai.
 *
 * Nota su `0`: e' trattato come "nessuna scadenza", non come "cancella subito".
 * `recordingDeleteAfterDays` e' validato `min(1)` (`lib/validation/schemas.ts`),
 * quindi uno 0 non arriva dall'API ma da un default o da una scrittura diretta,
 * e leggerlo come "scaduta all'istante" farebbe sparire al primo giro di cron
 * ogni registrazione.
 */
export function recordingExpiresAt(evt: RecordingRetentionRow): Date | null {
  if (!evt.recordingDeleteAfterDays) return null;
  const durata = evt.recordingDeleteAfterDays * DAY_MS;
  if (evt.recordingPublished) {
    return evt.recordingPublishedAt
      ? new Date(evt.recordingPublishedAt.getTime() + durata)
      : null;
  }
  const inizio = inizioConservazione(evt);
  if (!inizio) return null;
  const da = Math.max(inizio.getTime(), evt.recordingRetentionFrom?.getTime() ?? 0);
  return new Date(da + durata);
}

/**
 * La registrazione dell'evento ha superato la sua scadenza (fase 2)? Il
 * confronto e' stretto, come per i dati: l'ultimo giorno c'e' ancora.
 */
export function isRecordingRetentionExpired(evt: RecordingRetentionRow, now: Date): boolean {
  const scadenza = recordingExpiresAt(evt);
  return scadenza !== null && scadenza.getTime() < now.getTime();
}

/** La transazione di un evento nella pulizia: fa decine di istruzioni, e quelle
 *  sulle prove crescono con le persone. Il limite predefinito di Prisma (5
 *  secondi) farebbe fallire ogni giorno un evento grande, che non si
 *  ripulirebbe mai. */
export const TIMEOUT_PULIZIA_EVENTO_MS = 60_000;

/** Le transazioni in fila con la pulizia dello stesso evento (ritiri e
 *  cancellazioni): l'attesa conta nel limite, quindi devono poterla aspettare
 *  tutta e fare ancora il proprio lavoro. */
export const TIMEOUT_DOPO_PULIZIA_MS = TIMEOUT_PULIZIA_EVENTO_MS + 30_000;

export interface StatoEsistenzaProve {
  youtubeUrl: string | null;
  recordingUrl: string | null;
  tempRecordingUrl: string | null;
  /** Il file di una sessione ancora al suo posto, anche se non e' quello
   *  dell'evento: l'evento indica solo l'ultima sessione registrata. */
  fileDiSessione: boolean;
  /** Le tracce per persona ancora presenti di una registrazione che sull'evento
   *  non ha un indirizzo. Le altre registrazioni non contano: i campi qui sopra
   *  dicono gia' se il loro video c'e', e la riga resta anche dopo che il video e'
   *  stato tolto. */
  tracceArrivate: boolean;
  /** C'e' un artefatto di trascrizione, pubblicato o no. */
  trascrizioneEsiste: boolean;
}

/**
 * Quali prove di consenso restano: quelle delle voci che stanno in cio' che
 * esiste della registrazione, pubblicato o no. La registrazione non segue la
 * conservazione dei dati dei partecipanti, e le sue prove restano con lei: alla
 * pulizia dei dati, a una cancellazione chiesta da una persona (iscrizioni,
 * concessioni, account), e finche' il video o la trascrizione ci sono. Quando se
 * ne vanno (scadenza della registrazione, cancellazione dello staff) le prove si
 * cancellano al primo giro della pulizia.
 *
 *  - Un video (dell'evento, temporaneo, di una sessione, o un link esterno) o
 *    tracce per persona ancora presenti: restano entrambe, perche' la
 *    trascrizione viene da li'.
 *  - La sola trascrizione: resta la sua prova.
 *  - Niente: nessuna, e quelle gia' conservate si cancellano.
 *
 * Il link esterno vale finche' qualcuno non lo toglie: la piattaforma non sa
 * quando il video sparisce da un altro sito.
 */
export function tipiDiProvaDiCioCheEsiste(evt: StatoEsistenzaProve): TipoConsenso[] {
  if (
    evt.youtubeUrl ||
    evt.recordingUrl ||
    evt.tempRecordingUrl ||
    evt.fileDiSessione ||
    evt.tracceArrivate
  ) {
    return ['recording', 'transcription'];
  }
  return evt.trascrizioneEsiste ? ['transcription'] : [];
}
