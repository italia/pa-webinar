/**
 * Chi può LEGGERE i pannelli della sala live (Q&A, sondaggi).
 *
 * PERCHÉ ESISTE: ogni pannello si era scritto la propria regola, e le regole
 * non coincidevano. Il risultato, in diretta: in una chiamata istantanea — dove
 * *nessuno* ha un token perché si entra dal link — il pannello dei sondaggi
 * rispondeva 401 a tutta la sala e quello delle domande 403. Il moderatore
 * apriva un sondaggio e non lo vedeva nessuno. Stesso esito per i relatori: un
 * grant SPEAKER non è un token moderatore e non è una registrazione, quindi
 * cadeva nel ramo «token che non risolve».
 *
 * La regola sta qui, in un posto solo:
 *   • token moderatore (primario o co-moderatore non revocato) → vede tutto,
 *     risultati compresi anche a sondaggio aperto;
 *   • token relatore (grant SPEAKER non revocato) → vista del pubblico;
 *   • accessToken di una registrazione di QUESTO evento → vista del pubblico,
 *     con la propria risposta ricordata;
 *   • nessun token → vista del pubblico, ma solo finché la stanza è davvero
 *     aperta a chi arriva col link (`guestWindowOpen`, che tiene conto anche
 *     dell'accesso ospiti deciso dall'amministrazione) e l'evento non è
 *     protetto da password. È la stessa soglia della chat: chi può stare nella
 *     stanza può leggere la stanza.
 *
 * Un token che non risolve resta un errore, non un declassamento a ospite: un
 * link scaduto deve fallire a voce alta invece di trasformarsi in silenzio in
 * un visitatore anonimo (stesso contratto di `authorizeChatRead`).
 */

import { isEventModeratorCached } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { guestWindowOpen } from '@/lib/events/guest-window';
import { hasJoinGrant } from '@/lib/events/join-grant';
import { getSettings } from '@/lib/settings';

export type PanelReaderKind = 'moderator' | 'speaker' | 'participant' | 'guest';

export interface PanelReader {
  kind: PanelReaderKind;
  /** Presente solo per una registrazione: è l'identità con cui il server
   *  ricorda il voto o l'upvote. Ospiti e conduttori non ne hanno una. */
  registrationId: string | null;
  /** Solo il moderatore vede i risultati di un sondaggio ancora aperto. */
  isModerator: boolean;
}

export interface PanelReadEvent {
  id: string;
  status: string;
  eventType: string;
  moderatorToken: string;
  joinPasswordHash: string | null;
}

/** I campi che `authorizePanelRead` legge: da passare al `select` di Prisma,
 *  così una rotta non si porta dietro l'intera riga dell'evento. */
export const PANEL_READ_EVENT_SELECT = {
  id: true,
  status: true,
  eventType: true,
  moderatorToken: true,
  joinPasswordHash: true,
} as const;

export async function authorizePanelRead(
  event: PanelReadEvent,
  token: string | null | undefined,
): Promise<PanelReader> {
  if (token) {
    if (await isEventModeratorCached(event, token)) {
      return { kind: 'moderator', registrationId: null, isModerator: true };
    }

    const registration = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { id: true, eventId: true },
    });
    if (registration && registration.eventId === event.id) {
      return {
        kind: 'participant',
        registrationId: registration.id,
        isModerator: false,
      };
    }

    // Relatore: un grant nominale non revocato di questo evento. Non dà
    // moderazione (lo dice `isEventModerator`), ma è gente che sta in sala.
    const grant = await prisma.eventModerator.findUnique({
      where: { token },
      select: { eventId: true, revokedAt: true },
    });
    if (grant && grant.eventId === event.id && grant.revokedAt === null) {
      return { kind: 'speaker', registrationId: null, isModerator: false };
    }

    throw new ForbiddenError('Invalid token for this event');
  }

  if (!guestWindowOpen(event, (await getSettings()).guestAccessEnabled)) {
    throw new UnauthorizedError('Token required');
  }

  // Evento protetto da password: sapere l'indirizzo non basta per entrare,
  // quindi non basta nemmeno per leggere. È lo stesso cookie che la pagina
  // live pretende prima di consegnare il JWT ospite.
  if (event.joinPasswordHash && !(await hasJoinGrant(event.id))) {
    throw new UnauthorizedError('Token required');
  }

  return { kind: 'guest', registrationId: null, isModerator: false };
}
