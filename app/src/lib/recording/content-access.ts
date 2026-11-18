// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { cache } from 'react';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import {
  ambitoOrganizzatore,
  getStaffSession,
  requireStaff,
  type StaffSession,
} from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, NotFoundError } from '@/lib/errors';

/**
 * Chi dello staff vede il CONTENUTO delle registrazioni di un evento
 * (docs/adr/021-recording-content-access.md).
 *
 * Contenuto: il video della sala, le tracce per persona e l'archivio che le
 * unisce, la forma d'onda, le trascrizioni (dell'AI e dai sottotitoli) e il
 * loro editor, la sintesi, il resoconto, le traduzioni, i sottotitoli, il
 * doppiaggio. Vale per leggerlo e per cambiarlo, e per i lavori che lo
 * producono a partire da quello che c'e'. I metadati (che una registrazione
 * esiste, il suo stato, durata, dimensione, lo stato dei lavori) restano di
 * chi gestisce l'evento, admin compreso (lib/auth/staff-session).
 *
 * Lo vede l'organizzatore: l'account dello staff che ha creato l'evento o
 * che ne ha una concessione da organizzatore (`ambitoOrganizzatore`), con
 * qualunque ruolo. L'admin che non lo organizza non lo vede; la sessione con
 * la chiave dell'istanza (`accountId` null) mai, perche' non ha una persona
 * dietro. Chi ha partecipato e il pubblico passano da lib/recording/audience,
 * le macchine (worker, cron) dalle proprie rotte interne.
 *
 * Punto d'estensione: le DEROGHE (`DEROGHE_CONTENUTO`). Una deroga e' una
 * funzione che, per una superficie di una registrazione, puo' aprire il
 * contenuto a un account che non organizza l'evento, per un motivo che sa
 * verificare da se' (per esempio una richiesta di rimozione aperta su quella
 * registrazione). Una deroga non vale per la chiave dell'istanza, si valuta
 * solo dopo che l'account si e' rivelato non organizzatore, e ogni lettura
 * che apre si traccia come quelle dell'organizzatore, con `via: 'deroga'`.
 */

/** Dove si chiede il contenuto: entra nel registro e lo leggono le deroghe. */
export type SuperficieContenuto =
  /** Il video della sala (il mix), in riproduzione o da scaricare. */
  | 'video'
  /** Le tracce audio per persona e l'archivio che le contiene. */
  | 'tracce'
  /** La trascrizione (dell'AI o dai sottotitoli), in lettura o in modifica. */
  | 'trascrizione'
  /** La sintesi e le sue traduzioni. */
  | 'sintesi'
  /** Il resoconto dell'evento. */
  | 'resoconto'
  /** Le persone che parlano: nomi assegnati, frasi d'esempio, nomi proposti. */
  | 'relatori'
  /** Un lavoro che produce contenuto da quello che c'e': trascrivere,
   *  rilanciare, tradurre, doppiare, archiviare, ricostruire dai sottotitoli. */
  | 'elaborazione'
  /** Una scelta che espone il contenuto: pubblicarlo, cambiarne il file. */
  | 'pubblicazione';

/** Come si e' arrivati al contenuto, per il registro. */
export type ViaContenuto = 'organizzatore' | 'deroga';

/** Cio' che una deroga riceve per decidere. */
export interface RichiestaDeroga {
  /** L'account dello staff: mai null, la chiave dell'istanza non ha deroghe. */
  accountId: string;
  ruolo: StaffSession['role'];
  eventId: string;
  /** La registrazione chiesta; null per le superfici dell'evento intero (il
   *  resoconto, la pubblicazione, il video dell'evento senza `Recording`). */
  recordingId: string | null;
  superficie: SuperficieContenuto;
}

/**
 * Una deroga all'accesso dell'organizzatore. True apre il contenuto per questa
 * richiesta, e solo per questa: la funzione si chiama a ogni richiesta, e una
 * deroga scaduta smette di valere alla successiva. Non deve lanciare: un
 * errore vale come «no» (lo si scrive nel log).
 */
export type DerogaContenuto = (richiesta: RichiestaDeroga) => Promise<boolean>;

/**
 * Le deroghe in vigore, in ordine. Vuoto: il contenuto e' solo
 * dell'organizzatore. Una funzione nuova si aggiunge qui, e la sua regola sta
 * nel suo modulo, con i suoi test.
 */
export const DEROGHE_CONTENUTO: readonly DerogaContenuto[] = [];

/** L'impronta dell'indirizzo dell'account, che riconosce le concessioni. */
const improntaAccount = cache(async (accountId: string): Promise<string | null> => {
  const account = await prisma.staffAccount.findUnique({
    where: { id: accountId },
    select: { emailHash: true, active: true },
  });
  return account?.active ? account.emailHash : null;
});

/**
 * Se la sessione organizza l'evento: lo ha creato o ne ha una concessione da
 * organizzatore. Mai per la chiave dell'istanza. Memorizzata per richiesta.
 */
export const organizzaEvento = cache(async function organizzaEvento(
  session: StaffSession,
  eventId: string
): Promise<boolean> {
  if (!session.accountId) return false;
  const impronta =
    session.role === 'organizer'
      ? session.emailHash
      : await improntaAccount(session.accountId);
  if (!impronta) return false;
  const trovati = await prisma.event.count({
    where: { id: eventId, ...ambitoOrganizzatore(session.accountId, impronta) },
  });
  return trovati > 0;
});

/**
 * Fra gli eventi indicati, quelli che la sessione organizza: per gli elenchi,
 * una lettura sola invece di una per riga.
 */
export async function eventiOrganizzati(
  session: StaffSession,
  eventIds: readonly string[]
): Promise<Set<string>> {
  const unici = [...new Set(eventIds)];
  if (!session.accountId || unici.length === 0) return new Set();
  const impronta =
    session.role === 'organizer'
      ? session.emailHash
      : await improntaAccount(session.accountId);
  if (!impronta) return new Set();
  const righe = await prisma.event.findMany({
    where: { id: { in: unici }, ...ambitoOrganizzatore(session.accountId, impronta) },
    select: { id: true },
  });
  return new Set(righe.map((r) => r.id));
}

/**
 * Se la sessione vede il contenuto di questa superficie, e perche'. Null: non
 * lo vede. Prima l'organizzatore, poi le deroghe, mai la chiave dell'istanza.
 */
export async function accessoContenutoStaff(
  session: StaffSession,
  richiesta: {
    eventId: string;
    recordingId: string | null;
    superficie: SuperficieContenuto;
  },
  /** Le deroghe da valutare: quelle in vigore; i test ne passano di proprie. */
  deroghe: readonly DerogaContenuto[] = DEROGHE_CONTENUTO
): Promise<ViaContenuto | null> {
  if (!session.accountId) return null;
  if (await organizzaEvento(session, richiesta.eventId)) return 'organizzatore';
  for (const deroga of deroghe) {
    try {
      if (
        await deroga({
          accountId: session.accountId,
          ruolo: session.role,
          eventId: richiesta.eventId,
          recordingId: richiesta.recordingId,
          superficie: richiesta.superficie,
        })
      ) {
        return 'deroga';
      }
    } catch (err) {
      console.error(
        '[content-access] deroga non valutata',
        err instanceof Error ? err.message : err
      );
    }
  }
  return null;
}

/** Il rifiuto di chi gestisce l'evento ma non ne vede il contenuto: un codice
 *  proprio, perche' l'interfaccia lo spieghi invece di dire «vietato». */
export function contenutoNegato(): AppError {
  return new AppError(
    'Recording content is available to the event organizers only',
    403,
    'RECORDING_CONTENT_ORGANIZER_ONLY'
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessoConcesso {
  session: StaffSession;
  eventId: string;
  via: ViaContenuto;
}

/**
 * Il contenuto di una registrazione, per lo staff: 401 senza sessione, 403
 * per chi non gestisce l'evento (come `requireRecordingManager`, senza dire
 * se la registrazione esiste), 403 con `RECORDING_CONTENT_ORGANIZER_ONLY` per
 * chi lo gestisce ma non lo organizza, 404 per la registrazione che non c'e'
 * a chi la potrebbe vedere.
 */
export async function requireRecordingContent(
  cookies: ReadonlyRequestCookies,
  recordingId: string,
  superficie: SuperficieContenuto
): Promise<AccessoConcesso> {
  const session = await requireStaff(cookies);
  if (!UUID_RE.test(recordingId)) throw nonTrovata(session, 'Recording');
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { eventId: true },
  });
  if (!recording) throw nonTrovata(session, 'Recording');
  return concedi(session, recording.eventId, recordingId, superficie);
}

/**
 * Cio' che non c'e' (o non puo' esserci, con un identificativo malformato):
 * l'organizzatore non scopre quali registrazioni esistono altrove, e riceve il
 * 403 di una registrazione altrui; l'admin, che le elenca tutte, 404.
 */
function nonTrovata(session: StaffSession, cosa: string): AppError {
  return session.role === 'admin' ? new NotFoundError(cosa) : new ForbiddenError();
}

/** Come `requireRecordingContent`, per il relatore di una registrazione. */
export async function requireSpeakerContent(
  cookies: ReadonlyRequestCookies,
  speakerId: string,
  superficie: SuperficieContenuto
): Promise<AccessoConcesso & { recordingId: string }> {
  const session = await requireStaff(cookies);
  if (!UUID_RE.test(speakerId)) throw nonTrovata(session, 'Speaker');
  const speaker = await prisma.speaker.findUnique({
    where: { id: speakerId },
    select: { recordingId: true, recording: { select: { eventId: true } } },
  });
  if (!speaker) throw nonTrovata(session, 'Speaker');
  const accesso = await concedi(
    session,
    speaker.recording.eventId,
    speaker.recordingId,
    superficie
  );
  return { ...accesso, recordingId: speaker.recordingId };
}

/** Il contenuto dell'evento intero (resoconto, pubblicazione, video senza `Recording`). */
export async function requireEventContent(
  cookies: ReadonlyRequestCookies,
  eventId: string,
  superficie: SuperficieContenuto
): Promise<AccessoConcesso> {
  if (!UUID_RE.test(eventId)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  const session = await requireStaff(cookies);
  return concedi(session, eventId, null, superficie);
}

async function concedi(
  session: StaffSession,
  eventId: string,
  recordingId: string | null,
  superficie: SuperficieContenuto
): Promise<AccessoConcesso> {
  const via = await accessoContenutoStaff(session, { eventId, recordingId, superficie });
  if (via) return { session, eventId, via };
  // Chi non gestisce l'evento non sa nemmeno che esiste: il 403 di sempre.
  // Chi lo gestisce (l'admin) sa che c'e' un contenuto e che non e' suo.
  const gestisce = session.role === 'admin';
  throw gestisce ? contenutoNegato() : new ForbiddenError();
}

/**
 * Se lo staff della richiesta vede il contenuto dell'evento, senza rifiutare:
 * per le pagine e le rotte aperte anche al pubblico (lib/recording/audience).
 */
export async function contenutoStaffDellaRichiesta(
  cookies: ReadonlyRequestCookies,
  eventId: string,
  superficie: SuperficieContenuto = 'video'
): Promise<{ session: StaffSession; via: ViaContenuto } | null> {
  const session = await getStaffSession(cookies);
  if (!session) return null;
  const via = await accessoContenutoStaff(session, {
    eventId,
    recordingId: null,
    superficie,
  });
  return via ? { session, via } : null;
}

/** Entro questo tempo la stessa lettura della stessa persona non si riscrive. */
const FINESTRA_REGISTRO_MS = 15 * 60_000;

export const AZIONE_LETTURA_CONTENUTO = 'RECORDING_CONTENT_READ';

/**
 * Traccia una lettura del contenuto fatta in quanto staff, nel registro GDPR
 * dell'evento: quale superficie, quale registrazione, per quale via e quale
 * account (l'identificativo opaco, senza nome, indirizzo o IP). Le letture di
 * chi partecipa o del pubblico non si tracciano qui: non sono un privilegio
 * dello staff. La stessa lettura ripetuta entro un quarto d'ora non si
 * riscrive (l'editor la chiede a ogni apertura). Un errore di scrittura non
 * ferma la lettura: lo si scrive nel log.
 */
export async function tracciaLetturaContenuto(input: {
  eventId: string;
  recordingId: string | null;
  superficie: SuperficieContenuto;
  session: StaffSession;
  via: ViaContenuto;
}): Promise<void> {
  // L'ordine delle chiavi e' fisso: il testo serve anche a riconoscere la
  // stessa lettura.
  const details = JSON.stringify({
    surface: input.superficie,
    recordingId: input.recordingId,
    via: input.via,
    role: input.session.role,
    account: input.session.accountId,
  });
  try {
    const recente = await prisma.gdprAuditLog.findFirst({
      where: {
        eventId: input.eventId,
        action: AZIONE_LETTURA_CONTENUTO,
        details,
        createdAt: { gte: new Date(Date.now() - FINESTRA_REGISTRO_MS) },
      },
      select: { id: true },
    });
    if (recente) return;
    await prisma.gdprAuditLog.create({
      data: {
        eventId: input.eventId,
        action: AZIONE_LETTURA_CONTENUTO,
        recordCount: 1,
        details,
      },
    });
  } catch (err) {
    console.error(
      '[content-access] lettura non tracciata',
      err instanceof Error ? err.message : err
    );
  }
}
