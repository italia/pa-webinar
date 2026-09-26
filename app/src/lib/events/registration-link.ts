/**
 * Il link personale d'ingresso di un'iscrizione, come va nelle email.
 *
 * Di norma è `/events/{slug}/live?token=…`. Chi lo apre entra nella sala; come
 * la persona iscritta, con il suo nome e i suoi consensi, solo sul browser da
 * cui si è iscritta, che ha il cookie firmato `event_access`
 * (lib/event-session). Altrove entra con il nome che scrive: un link inoltrato
 * dà un posto, non l'identità di chi l'ha ricevuto.
 *
 * Con l'iscrizione pubblica spenta (lib/events/registration-access) il browser
 * da cui si compila il modulo non prova niente: l'indirizzo non è verificato, e
 * chi conosce quello di un invitato potrebbe iscriversi al suo posto. Il link
 * personale allora lo consegna soltanto l'email, e la prova d'identità è
 * averla aperta: il link passa da `/api/events/{slug}/registrations/enter`, che
 * lega il browser all'iscrizione con lo stesso cookie e porta nella sala. La
 * firma distingue il link dell'email dal token visto altrove — nella barra
 * degli indirizzi, in una chat —, che resta un posto senza identità. Gli
 * eventi di calendario che l'email propone di creare hanno invece il link
 * della sala: un evento di calendario si inoltra e si condivide senza pensarci.
 *
 * La firma non scade: non scade nemmeno il token, e il cookie che ne nasce
 * dura fino a poco dopo la fine dell'evento. Non è monouso: i filtri antivirus
 * della posta aprono i link prima della persona, e un link consumato da loro
 * arriverebbe già inutilizzabile.
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { requireAppSecret } from '@/lib/auth/app-secret';
import { localizedUrl } from '@/lib/utils/localized-url';

function firma(eventId: string, accessToken: string): Buffer {
  return createHmac('sha256', requireAppSecret())
    .update(`registration-enter:${eventId}:${accessToken}`)
    .digest();
}

/** La firma del link d'ingresso dell'email, in base64url. */
export function signRegistrationEntry(eventId: string, accessToken: string): string {
  return firma(eventId, accessToken).toString('base64url');
}

/** Vero se la firma è quella del link dell'email per questa iscrizione. */
export function verifyRegistrationEntry(
  eventId: string,
  accessToken: string,
  signature: string,
): boolean {
  if (!accessToken || !signature) return false;
  let attesa: Buffer;
  try {
    attesa = firma(eventId, accessToken);
  } catch {
    // Nessun segreto utilizzabile: si nega, e il link vale come un posto.
    return false;
  }
  const data = Buffer.from(signature, 'base64url');
  return data.length === attesa.length && timingSafeEqual(data, attesa);
}

interface RegistrationJoinUrlInput {
  baseUrl: string;
  slug: string;
  eventId: string;
  accessToken: string;
  locale: string;
  /** Iscrizione pubblica spenta: il link passa dalla rotta d'ingresso. */
  viaEmailEntry: boolean;
}

/** Il link personale da mettere nelle email dell'iscrizione. */
export function registrationJoinUrl({
  baseUrl,
  slug,
  eventId,
  accessToken,
  locale,
  viaEmailEntry,
}: RegistrationJoinUrlInput): string {
  if (!viaEmailEntry) {
    return localizedUrl(baseUrl, `/events/${slug}/live?token=${accessToken}`, locale);
  }
  const query = new URLSearchParams({
    token: accessToken,
    sig: signRegistrationEntry(eventId, accessToken),
    lang: locale,
  });
  return `${baseUrl}/api/events/${encodeURIComponent(slug)}/registrations/enter?${query}`;
}
