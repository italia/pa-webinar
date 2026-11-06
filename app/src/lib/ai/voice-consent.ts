// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il consenso alla trascrizione voce per voce.
 *
 * Un evento che registra una traccia audio per persona, tiene la trascrizione
 * dai sottotitoli o trascrive il video con la pipeline AI chiede a ognuno se i
 * propri interventi possono entrare nella trascrizione con il proprio nome.
 * Il video completo della sala contiene anche le voci di chi ha detto no:
 * trascriverlo in blocco annullerebbe la scelta. Per questo la pipeline non
 * trascrive da sola un video senza tracce per persona, e chi la avvia a mano
 * deve confermare che tutte le voci del video hanno acconsentito. La conferma
 * si chiede anche se parla solo chi conduce: il video non dice chi ha parlato.
 *
 * Le regole sono due, e non vanno confuse. `chiedeConsensoPerVoce` decide cosa
 * chiedere a chi entra. `regimeConsensoVoce` decide gli effetti su una
 * registrazione gia' fatta: una domanda nata dopo non si applica a chi non
 * l'ha mai ricevuta, e il segno `Recording.transcriptConsentRule` distingue le
 * registrazioni nate sotto la regola sul video da quelle nate prima.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { captionsTranscriptActive } from '@/lib/captions/availability';
import { isMultitrackPlaceholder } from '@/lib/recorder/lifecycle';
import { recordingAvailable, voceNelVideo } from '@/lib/recording/availability';
import { AppError, ValidationError } from '@/lib/errors';
import {
  trascrizioneDalVideo,
  trascrizioneRichiesta,
  VERSIONE_TESTO_TRASCRIZIONE,
} from '@/lib/registration/consents';

import { CODICE_CONFERMA_VOCI } from './voice-consent-code';

export interface EventoConsensoVoce {
  multitrackRecordingEnabled: boolean;
  captionsTranscriptEnabled: boolean;
  liveCaptionsEnabled?: boolean | null;
  // Per la trascrizione dal video: senza, il video non conta.
  eventType?: string | null;
  recordingEnabled?: boolean;
  aiTranscriptEnabled?: boolean;
}

export interface SitoConsensoVoce {
  liveCaptionsEnabled?: boolean | null;
  // Per la trascrizione dal video: senza, il video non conta.
  aiPipelineEnabled?: boolean | null;
}

/**
 * La regola di adesso, la stessa del modulo d'iscrizione e della sala d'attesa
 * (lib/registration/consents): si chiede il consenso se l'evento registra una
 * traccia per persona, tiene davvero la trascrizione dai sottotitoli (scelta,
 * sottotitoli accesi, servizio presente) o trascrive il video con la pipeline
 * AI. Legge l'ambiente: si chiama solo sul server.
 */
export function chiedeConsensoPerVoce(
  e: EventoConsensoVoce,
  sito: SitoConsensoVoce
): boolean {
  return trascrizioneRichiesta({
    multitrackRecordingEnabled: e.multitrackRecordingEnabled,
    captionsTranscript: captionsTranscriptActive(e, sito),
    trascrizioneVideo: trascrizioneDalVideo(
      e,
      sito,
      recordingAvailable(),
      voceNelVideo()
    ),
  });
}

/**
 * La versione del testo che il consenso alla trascrizione deve avere adesso:
 * quella che comprende il nome, dove l'evento trascrive davvero dai sottotitoli,
 * dal video o dalle tracce per persona con la pipeline AI
 * (lib/registration/consents). Senza pipeline le tracce non si trascrivono, e il
 * testo di prima basta. La stessa regola per la casella che si ripropone in sala
 * d'attesa, per il registratore e per lo stato che il token riporta alla sala.
 * Legge l'ambiente: si chiama solo sul server.
 */
export function versioneConsensoTrascrizione(
  e: EventoConsensoVoce,
  sito: SitoConsensoVoce
): number {
  const tracceDaTrascrivere =
    e.multitrackRecordingEnabled && !!e.aiTranscriptEnabled && !!sito.aiPipelineEnabled;
  const trascrive =
    captionsTranscriptActive(e, sito) ||
    trascrizioneDalVideo(e, sito, recordingAvailable(), voceNelVideo()) ||
    tracceDaTrascrivere;
  return trascrive ? VERSIONE_TESTO_TRASCRIZIONE : 1;
}

type Db = PrismaClient | Prisma.TransactionClient;

export interface RegimeConsensoVoce {
  /** Il consenso voce per voce e' stato chiesto. */
  chiesto: boolean;
  /**
   * La versione minima del testo che conta per mostrare un nome: quella che lo
   * comprende, con la trascrizione dai sottotitoli o con il segno della
   * registrazione.
   */
  versione: number;
}

/**
 * Se il consenso voce per voce e' stato chiesto, e con quale testo: la
 * traccia per persona o la trascrizione dai sottotitoli dell'evento, oppure
 * le tracce che solo il controllo in sala lascia (frasi dei sottotitoli
 * salvate, prove di consenso date in sala d'attesa, tracce per persona
 * registrate), oppure il segno della registrazione. Un interruttore spento
 * dopo l'evento non restituisce cosi' i nomi di chi aveva detto no, ne' fa
 * trascrivere il video completo senza conferma; e se la trascrizione dai
 * sottotitoli ha girato, vale il testo che comprende il nome anche dopo.
 *
 * Le sole risposte all'iscrizione non bastano: l'interruttore puo' essere
 * stato spento prima dell'evento, e allora in sala nessuno ha chiesto niente.
 *
 * Non passa da `chiedeConsensoPerVoce`, che comprende il video: chi era in
 * una registrazione nata prima di quella regola non ha ricevuto la domanda, e
 * applicarla toglierebbe i nomi da trascrizioni pubblicate e chiederebbe una
 * conferma a ogni rilancio. Per questo `segnoRegistrazione` e' obbligatorio:
 * legge Recording.transcriptConsentRule della registrazione in esame, non
 * dell'evento, perche' un evento ricorrente puo' avere righe vecchie e nuove.
 * Vero, la domanda vale anche per il video e servono consensi al testo che
 * comprende il nome; falso, restano le altre condizioni.
 */
export async function regimeConsensoVoce(
  db: Db,
  eventId: string,
  e: EventoConsensoVoce,
  sito: SitoConsensoVoce,
  segnoRegistrazione: boolean
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
    chiesto:
      segnoRegistrazione ||
      e.multitrackRecordingEnabled ||
      sottotitoli ||
      Boolean(prova || traccia),
    versione: segnoRegistrazione || sottotitoli ? VERSIONE_TESTO_TRASCRIZIONE : 1,
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
 * hanno acconsentito: e' il video completo (non le tracce per persona) e il
 * consenso voce per voce e' stato chiesto, oppure la registrazione ha il segno.
 * La stessa regola per la pipeline, per la pagina che la avvia e per la
 * chiusura dell'evento.
 */
export async function confermaVociNecessaria(
  db: Db,
  rec: { id: string; blobKey: string; eventId: string; transcriptConsentRule: boolean },
  e: EventoConsensoVoce,
  sito: SitoConsensoVoce,
  multitraccia?: boolean
): Promise<boolean> {
  if (rec.blobKey === '') return false;
  if (multitraccia ?? (await registrazioneMultitraccia(db, rec))) return false;
  return (await regimeConsensoVoce(db, rec.eventId, e, sito, rec.transcriptConsentRule))
    .chiesto;
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
    'The full room recording contains every voice, including people who did not consent to the transcription of what they say. Confirm that every voice in the recording has consented to transcribe it.',
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
  summary: z.unknown().optional().transform((v) => v === true),
  translation: z.unknown().optional().transform((v) => v === true),
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
