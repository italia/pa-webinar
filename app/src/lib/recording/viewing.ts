import { issueScopedLinkToken, verifyScopedLinkToken } from '@/lib/auth/scoped-link';

/**
 * Il link personale per vedere una registrazione riservata agli iscritti
 * (Event.recordingAudience = REGISTRANTS): arriva a ogni iscritto con l'avviso
 * «registrazione disponibile» e passa da `/api/events/[slug]/recording/access`,
 * che posa il cookie della visione e porta alla pagina dell'evento.
 *
 * Il token lega l'iscrizione all'evento e serve solo a guardare (lib/auth/
 * scoped-link): non apre la sala. Il cookie porta lo stesso token, dura a
 * lungo perche' la registrazione esce giorni dopo l'evento, e vale solo
 * finche' l'iscrizione esiste (lib/recording/audience).
 */

const SCOPO = 'visione|';

/** Abbastanza per tornare a guardare; la finestra vera la decide l'evento. */
export const VIEWING_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export function viewingCookieName(eventId: string): string {
  return `recording_access_${eventId}`;
}

export function issueViewingToken(
  eventId: string,
  registrationId: string
): string | null {
  return issueScopedLinkToken(SCOPO, eventId, registrationId);
}

/** L'iscrizione del token, se valido e di questo evento. */
export function verifyViewingToken(
  token: string | undefined,
  eventId: string
): string | null {
  if (!token) return null;
  return verifyScopedLinkToken(SCOPO, token, eventId);
}

/** L'header `Set-Cookie` del cookie della visione. */
export function buildViewingSetCookie(eventId: string, token: string): string {
  return [
    `${viewingCookieName(eventId)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${VIEWING_COOKIE_MAX_AGE_SECONDS}`,
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * L'indirizzo del link personale: passa da `/recording/access`, che posa il
 * cookie e porta alla pagina dell'evento nella lingua `lang`.
 */
export function viewingLinkUrl(
  baseUrl: string,
  slug: string,
  token: string,
  lang: string
): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/events/${slug}/recording/access?t=${encodeURIComponent(token)}&lang=${lang}`;
}
