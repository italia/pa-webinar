/**
 * Il link personale d'ingresso di un'iscrizione, come va nelle email.
 *
 * Di norma è `/events/{slug}/live?token=…`. Chi lo apre entra nella sala; come
 * la persona iscritta, con il suo nome e i suoi consensi, solo sul browser da
 * cui si è iscritta, che ha il cookie firmato `event_access`
 * (lib/event-session). Altrove entra con il nome che scrive: un link inoltrato
 * dà un posto, non l'identità di chi l'ha ricevuto.
 *
 * Il browser da cui si compila il modulo non prova niente sull'indirizzo: chi
 * conosce quello di un altro potrebbe iscriversi al suo posto. Il link delle
 * email allora passa da `/api/events/{slug}/registrations/enter` con una firma,
 * e la prova è averla aperta. Due firme, scelte quando l'email parte:
 * - `sig`, con l'iscrizione pubblica spenta (lib/events/registration-access):
 *   il link personale lo consegna soltanto l'email, e la rotta lega
 *   all'iscrizione il browser che lo apre;
 * - `proof`, con l'iscrizione pubblica accesa: l'identità resta del browser
 *   che si è iscritto, e il link aggiunge al suo cookie la prova
 *   dell'indirizzo; un altro browser entra con il solo token.
 * In entrambi i casi il cookie porta la prova dell'indirizzo, che serve a ciò
 * che vale per l'indirizzo in tutti gli eventi (la foto profilo). La firma è
 * fissata nel link: un'email già partita continua a valere come quando è
 * partita, anche se nel frattempo l'impostazione cambia. La firma distingue
 * il link dell'email dal token visto altrove — nella barra degli indirizzi,
 * in una chat —, che resta un posto senza identità. Gli eventi di calendario
 * che l'email propone di creare hanno invece il link della sala: un evento di
 * calendario si inoltra e si condivide senza pensarci.
 *
 * La firma non scade: non scade nemmeno il token, e il cookie che ne nasce
 * dura fino a poco dopo la fine dell'evento. Non è monouso: i filtri antivirus
 * della posta aprono i link prima della persona, e un link consumato da loro
 * arriverebbe già inutilizzabile.
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { requireAppSecret } from '@/lib/auth/app-secret';
import { localizedUrl } from '@/lib/utils/localized-url';

function firma(scopo: 'registration-enter' | 'registration-proof', eventId: string, accessToken: string): Buffer {
  return createHmac('sha256', requireAppSecret())
    .update(`${scopo}:${eventId}:${accessToken}`)
    .digest();
}

function verifica(
  scopo: 'registration-enter' | 'registration-proof',
  eventId: string,
  accessToken: string,
  signature: string,
): boolean {
  if (!accessToken || !signature) return false;
  let attesa: Buffer;
  try {
    attesa = firma(scopo, eventId, accessToken);
  } catch {
    // Nessun segreto utilizzabile: si nega, e il link vale come un posto.
    return false;
  }
  const data = Buffer.from(signature, 'base64url');
  return data.length === attesa.length && timingSafeEqual(data, attesa);
}

/** La firma `sig` (lega il browser che apre), in base64url. */
export function signRegistrationEntry(eventId: string, accessToken: string): string {
  return firma('registration-enter', eventId, accessToken).toString('base64url');
}

/** Vero se `sig` è quella del link dell'email per questa iscrizione. */
export function verifyRegistrationEntry(eventId: string, accessToken: string, signature: string): boolean {
  return verifica('registration-enter', eventId, accessToken, signature);
}

/** La firma `proof` (prova l'indirizzo al browser che già ha l'identità). */
export function signRegistrationProof(eventId: string, accessToken: string): string {
  return firma('registration-proof', eventId, accessToken).toString('base64url');
}

/** Vero se `proof` è quella del link dell'email per questa iscrizione. */
export function verifyRegistrationProof(eventId: string, accessToken: string, signature: string): boolean {
  return verifica('registration-proof', eventId, accessToken, signature);
}

interface RegistrationJoinUrlInput {
  baseUrl: string;
  slug: string;
  eventId: string;
  accessToken: string;
  locale: string;
  /** Il link dell'email (con la firma), non quello da inoltrare. */
  viaEmailEntry: boolean;
  /** Con `viaEmailEntry`: il link lega l'identità a chi lo apre (iscrizione
   *  pubblica spenta). Altrimenti prova l'indirizzo e basta. */
  bindsIdentity?: boolean;
}

/** Il link personale da mettere nelle email dell'iscrizione. */
export function registrationJoinUrl({
  baseUrl,
  slug,
  eventId,
  accessToken,
  locale,
  viaEmailEntry,
  bindsIdentity = false,
}: RegistrationJoinUrlInput): string {
  if (!viaEmailEntry) {
    return localizedUrl(baseUrl, `/events/${slug}/live?token=${accessToken}`, locale);
  }
  const query = new URLSearchParams({
    token: accessToken,
    ...(bindsIdentity
      ? { sig: signRegistrationEntry(eventId, accessToken) }
      : { proof: signRegistrationProof(eventId, accessToken) }),
    lang: locale,
  });
  return `${baseUrl}/api/events/${encodeURIComponent(slug)}/registrations/enter?${query}`;
}
