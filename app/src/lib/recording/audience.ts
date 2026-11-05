// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { EventStatus, RecordingAudience } from '@prisma/client';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import { isEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { eventAccessCookieName, verifyEventAccess } from '@/lib/event-session';

import { verifyViewingToken, viewingCookieName } from './viewing';

/**
 * Chi vede la registrazione di un evento e cio' che ne deriva: il video, la
 * trascrizione, la sintesi, le traduzioni, il doppiaggio, le slide accanto al
 * video. Regola unica: la applicano la pagina dell'evento e le rotte che
 * servono quei contenuti.
 *
 *  - Pubblicata (video o sola trascrizione) e dentro la finestra post-evento
 *    (`postEventPublic`, `postEventPublicUntil`):
 *      PUBLIC      → chiunque;
 *      REGISTRANTS → chi prova di essersi iscritto all'evento, anche se non e'
 *                    mai entrato in sala: il cookie della visione (dal link
 *                    personale dell'avviso «registrazione disponibile») o il
 *                    cookie d'accesso dell'evento, che dura fino a qualche ora
 *                    dopo la fine. L'iscrizione deve esistere ancora: una
 *                    cancellazione la revoca, anche quella della pulizia dei
 *                    dati, e da li' resta lo staff.
 *  - Su un evento con destinazione (lib/recording/destination) REGISTRANTS non
 *    dipende da `postEventPublic`: la pagina puo' restare privata, e chi si e'
 *    iscritto vede comunque il video. La finestra `postEventPublicUntil` vale
 *    lo stesso. Gli eventi senza destinazione seguono la regola qui sopra.
 *  - Lo staff che gestisce l'evento la vede sempre, anche prima della
 *    pubblicazione: e' l'anteprima della pagina pubblica. Le rotte la
 *    servono; la pagina la mostra solo su richiesta (`?anteprima=1`).
 */

export type AccessoRegistrazione = 'pubblico' | 'iscritto' | 'staff' | null;

export interface EventoPerAccesso {
  id: string;
  recordingPublished: boolean;
  transcriptPublished: boolean;
  recordingAudience: RecordingAudience;
  /** Null: l'evento non l'ha dichiarata, e vale la regola di sempre. Obbligatorio:
   *  una lettura che dimentica la colonna darebbe una risposta diversa da quella
   *  della pagina sullo stesso evento, e il compilatore non lo direbbe. */
  recordingDestination: RecordingAudience | null;
  postEventPublic: boolean;
  postEventPublicUntil: Date | null;
}

/** Una registrazione per i soli iscritti su un evento che dichiara dove va. */
const riservataConDestinazione = (event: EventoPerAccesso): boolean =>
  event.recordingAudience === 'REGISTRANTS' && event.recordingDestination != null;

/** Pubblicata e dentro la finestra post-evento: vale per chiunque abbia accesso. */
export function pubblicazioneAperta(
  event: EventoPerAccesso,
  now: Date = new Date()
): boolean {
  if (!event.recordingPublished && !event.transcriptPublished) return false;
  if (!event.postEventPublic && !riservataConDestinazione(event)) return false;
  return !event.postEventPublicUntil || event.postEventPublicUntil >= now;
}

/**
 * Gli iscritti vedono la registrazione anche se la pagina dell'evento non si vede
 * (lib/events/visibility): cio' che ferma il pubblico sulla pagina non vale per
 * loro, e chi decide se aprirla o avvisarli deve chiederlo qui.
 */
export function apertaAgliIscritti(
  event: EventoPerAccesso,
  now: Date = new Date()
): boolean {
  return riservataConDestinazione(event) && pubblicazioneAperta(event, now);
}

export async function accessoRegistrazione(
  event: EventoPerAccesso,
  cookieStore: ReadonlyRequestCookies,
  now: Date = new Date()
): Promise<AccessoRegistrazione> {
  const aperta = pubblicazioneAperta(event, now);
  if (aperta && event.recordingAudience === 'PUBLIC') return 'pubblico';
  if (await isEventManager(cookieStore, event.id)) return 'staff';
  if (!aperta) return null;
  return (await iscrittoDellaRichiesta(event.id, cookieStore)) ? 'iscritto' : null;
}

export interface EventoPerVisione extends EventoPerAccesso {
  status: EventStatus;
}

/** L'anteprima dello staff: la chiede solo la pagina dell'evento. */
export interface AnteprimaPagina {
  /** Chi apre la pagina l'ha chiesta (`?anteprima=1`). */
  chiesta: boolean;
  /** La pagina si vede anche senza anteprima (lib/events/visibility). */
  paginaVisibile: boolean;
}

const SENZA_ANTEPRIMA: AnteprimaPagina = { chiesta: false, paginaVisibile: true };

export interface VisioneRegistrazione {
  /** Lo staff guarda in anteprima cio' che il pubblico non vede ancora. */
  anteprimaStaff: boolean;
  /** Vede la registrazione e cio' che ne deriva, come la trascrizione. */
  registrazione: boolean;
  /** Vede il video. Che il file ci sia lo dice `recordingUrl`. */
  video: boolean;
  /** La registrazione e' aperta ai soli iscritti, e chi guarda non lo e'. */
  soloIscritti: boolean;
}

const NESSUNA_VISIONE: VisioneRegistrazione = {
  anteprimaStaff: false,
  registrazione: false,
  video: false,
  soloIscritti: false,
};

/**
 * Cosa vede della registrazione chi apre una pagina dell'evento, dall'esito di
 * `accessoRegistrazione`. Lo staff vede il video gia' aperto a tutti; quello che
 * il pubblico non vede ancora, solo chiedendo l'anteprima.
 *
 * Vale solo a evento concluso (ENDED). Su un evento archiviato decide come la
 * pagina e non come la rotta del video: ARCHIVED non ha una pagina pubblica
 * (lib/events/visibility), la sala d'attesa non lo tratta da concluso, e lo
 * staff in anteprima non vi trova la registrazione. La rotta accetta anche
 * ARCHIVED perche' serve il file, a chi ne ha gia' il link.
 */
export function visioneRegistrazione(
  event: EventoPerVisione,
  accesso: AccessoRegistrazione,
  anteprima: AnteprimaPagina = SENZA_ANTEPRIMA,
  now: Date = new Date()
): VisioneRegistrazione {
  if (event.status !== 'ENDED') return NESSUNA_VISIONE;
  const aperta = pubblicazioneAperta(event, now);
  const anteprimaStaff =
    accesso === 'staff' && anteprima.chiesta && (!aperta || !anteprima.paginaVisibile);
  const registrazione =
    accesso === 'pubblico' ||
    accesso === 'iscritto' ||
    (accesso === 'staff' && (aperta || anteprimaStaff));
  return {
    anteprimaStaff,
    registrazione,
    video: registrazione && (event.recordingPublished || anteprimaStaff),
    soloIscritti: aperta && event.recordingAudience === 'REGISTRANTS' && !registrazione,
  };
}

/** Se il video si vede in questa richiesta (`visioneRegistrazione`). */
export function vedeVideo(
  event: EventoPerVisione,
  accesso: AccessoRegistrazione,
  anteprima: AnteprimaPagina = SENZA_ANTEPRIMA,
  now: Date = new Date()
): boolean {
  return visioneRegistrazione(event, accesso, anteprima, now).video;
}

/** Se la richiesta prova un'iscrizione ancora esistente a questo evento. */
async function iscrittoDellaRichiesta(
  eventId: string,
  cookieStore: ReadonlyRequestCookies
): Promise<boolean> {
  const dallaVisione = verifyViewingToken(
    cookieStore.get(viewingCookieName(eventId))?.value,
    eventId
  );
  if (dallaVisione) {
    const trovata = await prisma.registration.count({
      where: { id: dallaVisione, eventId },
    });
    if (trovata > 0) return true;
  }
  const accessToken = await verifyEventAccess(
    eventId,
    cookieStore.get(eventAccessCookieName(eventId))?.value
  );
  if (!accessToken) return false;
  const trovata = await prisma.registration.count({ where: { accessToken, eventId } });
  return trovata > 0;
}
