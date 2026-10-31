/**
 * Il consenso alla trascrizione voce per voce.
 *
 * Un evento che registra una traccia audio per persona, o che tiene la
 * trascrizione dai sottotitoli, chiede a ognuno se i propri interventi
 * possono entrare nella trascrizione con il proprio nome. In quegli eventi
 * il video completo della sala contiene anche le voci di chi ha detto no:
 * trascriverlo in blocco annullerebbe la scelta. Per questo la pipeline non
 * lo trascrive da sola, e chi la avvia a mano deve confermare che tutte le
 * voci del video hanno acconsentito.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { captionsTranscriptActive } from '@/lib/captions/availability';
import { isMultitrackPlaceholder } from '@/lib/recorder/lifecycle';
import { AppError, ValidationError } from '@/lib/errors';
import { VERSIONE_TESTO_TRASCRIZIONE } from '@/lib/registration/consents';

import { CODICE_CONFERMA_VOCI } from './voice-consent-code';

export interface EventoConsensoVoce {
  multitrackRecordingEnabled: boolean;
  captionsTranscriptEnabled: boolean;
  liveCaptionsEnabled?: boolean | null;
}

export interface SitoConsensoVoce {
  liveCaptionsEnabled?: boolean | null;
}

/**
 * La regola di adesso, la stessa della sala d'attesa: si chiede il consenso
 * se l'evento registra una traccia per persona o tiene davvero la
 * trascrizione dai sottotitoli (scelta, sottotitoli accesi, servizio presente).
 */
export function chiedeConsensoPerVoce(
  e: EventoConsensoVoce,
  sito: SitoConsensoVoce
): boolean {
  return e.multitrackRecordingEnabled || captionsTranscriptActive(e, sito);
}

type Db = PrismaClient | Prisma.TransactionClient;

export interface RegimeConsensoVoce {
  /** Il consenso voce per voce e' stato chiesto. */
  chiesto: boolean;
  /** La versione minima del testo che conta per mostrare un nome. */
  versione: number;
}

/**
 * Se il consenso voce per voce e' stato chiesto, e con quale testo: la
 * regola di adesso, oppure le tracce che solo il controllo in sala lascia
 * (frasi dei sottotitoli salvate, prove di consenso date in sala d'attesa,
 * tracce per persona registrate). Un interruttore spento dopo l'evento non
 * restituisce cosi' i nomi di chi aveva detto no, ne' fa trascrivere il video
 * completo senza conferma; e se la trascrizione dai sottotitoli ha girato,
 * vale il testo che comprende il nome anche dopo.
 *
 * Le sole risposte all'iscrizione non bastano: l'interruttore puo' essere
 * stato spento prima dell'evento, e allora in sala nessuno ha chiesto niente.
 */
export async function regimeConsensoVoce(
  db: Db,
  eventId: string,
  e: EventoConsensoVoce,
  sito: SitoConsensoVoce
): Promise<RegimeConsensoVoce> {
  const [frase, prova, traccia] = await Promise.all([
    db.captionSegment.findFirst({ where: { eventId }, select: { id: true } }),
    db.multitrackConsent.findFirst({ where: { eventId }, select: { id: true } }),
    db.recordingTrack.findFirst({
      where: { recording: { eventId } },
      select: { id: true },
    }),
  ]);
  const sottotitoli = captionsTranscriptActive(e, sito) || Boolean(frase);
  return {
    chiesto: chiedeConsensoPerVoce(e, sito) || Boolean(frase || prova || traccia),
    versione: sottotitoli ? VERSIONE_TESTO_TRASCRIZIONE : 1,
  };
}

/** La registrazione ha le tracce per persona (o le aspetta: il segnaposto). */
export async function registrazioneMultitraccia(
  db: Db,
  rec: { id: string; blobKey: string }
): Promise<boolean> {
  return (
    isMultitrackPlaceholder(rec.blobKey) ||
    (await db.recordingTrack.count({ where: { recordingId: rec.id } })) > 0
  );
}

/**
 * Trascrivere questa registrazione richiede la conferma che tutte le voci
 * hanno acconsentito: e' il video completo (non le tracce per persona) di un
 * evento in cui il consenso voce per voce e' stato chiesto. La stessa regola
 * per la pipeline e per la pagina che la avvia.
 */
export async function confermaVociNecessaria(
  db: Db,
  rec: { id: string; blobKey: string; eventId: string },
  e: EventoConsensoVoce,
  sito: SitoConsensoVoce,
  multitraccia?: boolean
): Promise<boolean> {
  if (rec.blobKey === '') return false;
  if (multitraccia ?? (await registrazioneMultitraccia(db, rec))) return false;
  return (await regimeConsensoVoce(db, rec.eventId, e, sito)).chiesto;
}

export { CODICE_CONFERMA_VOCI };

/**
 * L'errore con cui la pipeline chiede la conferma: 409, cosi' l'interfaccia
 * la chiede e ripete la richiesta con `allVoicesConsented: true`. Lanciato
 * dentro la transazione di chi accoda, annulla anche le modifiche gia' fatte
 * (interruttori AI, contatore delle esecuzioni).
 */
export function erroreConfermaVoci(): AppError {
  return new AppError(
    'This event asks each person for consent to the transcription of what they say, and the full room recording contains every voice. Confirm that every voice in the recording has consented to transcribe it.',
    409,
    CODICE_CONFERMA_VOCI
  );
}

/**
 * Il corpo delle rotte che avviano la pipeline a mano (generate-ai, rerun).
 * Come prima: i campi in piu' si ignorano, un corpo che non e' JSON vale come
 * vuoto, e sintesi e traduzioni si accendono solo con `true`. La sola
 * conferma sulle voci, se c'e', deve essere un booleano: non si deduce da una
 * stringa.
 */
export const corpoAvvioPipeline = z.object({
  // Come prima: solo `true` accende la sintesi o le traduzioni.
  summary: z.unknown().transform((v) => v === true),
  translation: z.unknown().transform((v) => v === true),
  allVoicesConsented: z.boolean().optional(),
});

export type CorpoAvvioPipeline = z.infer<typeof corpoAvvioPipeline>;

/** Legge e valida il corpo; assente o non JSON vale come vuoto. */
export async function leggiCorpoAvvio(request: Request): Promise<CorpoAvvioPipeline> {
  const vuoto: CorpoAvvioPipeline = { summary: false, translation: false };
  let dati: unknown;
  try {
    dati = JSON.parse(await request.text());
  } catch {
    return vuoto;
  }
  if (dati === null || typeof dati !== 'object' || Array.isArray(dati)) return vuoto;
  const esito = corpoAvvioPipeline.safeParse(dati);
  if (!esito.success) throw new ValidationError('Invalid body', esito.error.flatten());
  return esito.data;
}
