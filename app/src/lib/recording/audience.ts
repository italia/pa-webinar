import type { RecordingAudience } from '@prisma/client';
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
 *                    cancellazione la revoca.
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
  postEventPublic: boolean;
  postEventPublicUntil: Date | null;
}

/** Pubblicata e dentro la finestra post-evento: vale per chiunque abbia accesso. */
export function pubblicazioneAperta(
  event: EventoPerAccesso,
  now: Date = new Date()
): boolean {
  if (!event.recordingPublished && !event.transcriptPublished) return false;
  if (!event.postEventPublic) return false;
  return !event.postEventPublicUntil || event.postEventPublicUntil >= now;
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
