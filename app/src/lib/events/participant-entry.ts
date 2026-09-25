/**
 * Da dove entra chi partecipa, visto da chi gestisce l'evento.
 *
 * La pagina di gestione offre due ingressi, detti per nome: da moderatore, col
 * link di conduzione, e da partecipante, per vedere l'evento come lo vede il
 * pubblico. Il secondo non segue una regola sua: compone le due che decidono
 * gia' chi entra e da dove.
 *
 *   1. La stanza e' aperta adesso a chi arriva senza token
 *      (`lib/events/guest-window`) e si puo' ancora accendere (vedi
 *      `roomCanStillOpen`): si entra in sala come ospite. Se l'evento ha una
 *      password, la sala la chiede prima, come a chiunque.
 *   2. Altrimenti, se l'evento ha una pagina pubblica (`lib/events/visibility`),
 *      si apre quella: da li' ci si iscrive e si riceve il link personale, e
 *      a evento concluso c'e' il post-evento.
 *   3. Altrimenti — bozza, archiviato, chiamata rapida chiusa senza pagina
 *      post-evento — un ingresso da partecipante non esiste.
 */
import { guestWindowOpen } from './guest-window';
import { isEventPageVisible } from './visibility';

/**
 * In diretta la stanza c'e'. In allestimento e in pausa invece va ancora
 * accesa, e lo fa `/wake` — che rifiuta un evento oltre la sua fine, di
 * qualunque tipo. Lo scaler chiude quell'evento al giro successivo; se e'
 * fermo, l'evento resta in pausa e chi entrasse aspetterebbe la sala in
 * allestimento senza che si apra mai. Per questo in quegli stati la porta si
 * offre solo prima della fine.
 */
function roomCanStillOpen(
  event: { status: string; endsAt: Date | string },
  now: number,
): boolean {
  return event.status === 'LIVE' || new Date(event.endsAt).getTime() > now;
}

export interface ParticipantEntryEvent {
  slug: string;
  status: string;
  eventType: string;
  endsAt: Date | string;
  postEventPublic: boolean;
  postEventPublicUntil: Date | string | null;
}

export type ParticipantEntry =
  | { kind: 'room'; path: string }
  | { kind: 'page'; path: string }
  | null;

/**
 * @param guestEntryAllowed l'evento ammette ospiti, gia' risolto con
 *   `guestAccessAllowed` (per una chiamata rapida e' sempre vero). Passarlo al
 *   posto dell'impostazione del sito da' lo stesso risultato: la domanda 1 di
 *   `guestWindowOpen` e' la stessa `guestAccessAllowed`.
 * @param now l'istante di riferimento per la fine dell'evento e per le
 *   finestre a tempo della pagina pubblica (vedi `isEventPageVisible`).
 */
export function participantEntry(
  event: ParticipantEntryEvent,
  guestEntryAllowed: boolean,
  now: number = Date.now(),
): ParticipantEntry {
  if (guestWindowOpen(event, guestEntryAllowed) && roomCanStillOpen(event, now)) {
    return { kind: 'room', path: `/events/${event.slug}/live` };
  }
  if (isEventPageVisible(event, now)) {
    return { kind: 'page', path: `/events/${event.slug}` };
  }
  return null;
}

/**
 * L'invito alla sala di una chiamata rapida funziona adesso? E' la porta da
 * ospite (una chiamata rapida ammette sempre ospiti): fuori da li' l'indirizzo
 * risponde «non trovato», o porta a una sala che non si accende piu'.
 */
export function callInviteOpen(event: ParticipantEntryEvent, now: number = Date.now()): boolean {
  return event.eventType === 'INSTANT' && participantEntry(event, true, now)?.kind === 'room';
}

export type ShareLink = { kind: 'page'; path: string } | { kind: 'invite'; path: string } | null;

/**
 * Il link che si condivide dalla cima della pagina di gestione. Di un evento a
 * calendario e' la pagina pubblica, sempre: anche in bozza, da preparare per
 * quando esce. Una chiamata rapida una pagina pubblica non ce l'ha (salvo il
 * post-evento, se lo si rende pubblico), e si condivide l'invito alla sala
 * finche' funziona. Chiusa la chiamata senza pagina post-evento non resta
 * niente da condividere: un link che risponde «non trovato» non si offre.
 */
export function shareLink(event: ParticipantEntryEvent, now: number = Date.now()): ShareLink {
  if (event.eventType !== 'INSTANT' || isEventPageVisible(event, now)) {
    return { kind: 'page', path: `/events/${event.slug}` };
  }
  if (callInviteOpen(event, now)) {
    return { kind: 'invite', path: `/events/${event.slug}/live` };
  }
  return null;
}

/**
 * Chi conduce puo' entrare in sala? In bozza l'evento non esiste ancora per
 * nessuno; concluso o archiviato, la sala e' chiusa. Pubblicato si entra: dalla
 * sala d'attesa chi conduce avvia l'evento. In allestimento e in pausa si
 * entra finche' la stanza si puo' ancora accendere (`roomCanStillOpen`): e'
 * proprio quando il bridge si accende prima dell'inizio (o dopo una pausa) che
 * chi conduce arriva, e la sala d'attesa lo accompagna finche' e' pronta.
 */
const MODERATOR_ROOM_STATUSES = new Set(['PUBLISHED', 'PROVISIONING', 'IDLE', 'LIVE']);

export function moderatorRoomOpen(
  event: { status: string; endsAt: Date | string },
  now: number = Date.now(),
): boolean {
  if (!MODERATOR_ROOM_STATUSES.has(event.status)) return false;
  return event.status === 'PUBLISHED' || roomCanStillOpen(event, now);
}
