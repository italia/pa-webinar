import { createHmac, timingSafeEqual } from 'crypto';

import { tryGetAppSecret } from '@/lib/auth/app-secret';

/**
 * Il link della valutazione nell'email di ringraziamento: un token firmato che
 * serve solo a valutare un evento come una certa iscrizione. Non e' il token
 * d'iscrizione (una credenziale che apre la sala e i pannelli) e non va
 * nell'indirizzo una credenziale che dura: chi lo riceve inoltrato puo' al
 * massimo spendere quella valutazione, una volta.
 *
 * Formato: `<payload base64url>.<firma base64url>`, payload
 * `<eventId>:<registrationId>`. La firma separa lo scopo (`valutazione|`) da
 * quella degli altri link firmati con lo stesso segreto. Non scade: la
 * finestra della valutazione la decide l'evento (feedbackOpen).
 */

const SCOPO = 'valutazione|';

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const daB64url = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64');

function firma(segreto: string, payload: string): Buffer {
  return createHmac('sha256', segreto).update(SCOPO + payload).digest();
}

export function issueRatingToken(eventId: string, registrationId: string): string | null {
  const segreto = tryGetAppSecret();
  if (!segreto) return null;
  const payload = b64url(Buffer.from(`${eventId}:${registrationId}`, 'utf8'));
  return `${payload}.${b64url(firma(segreto, payload))}`;
}

/** L'iscrizione del link, se il token e' valido e di questo evento. */
export function verifyRatingToken(token: string, eventId: string): string | null {
  const segreto = tryGetAppSecret();
  const punto = token.indexOf('.');
  if (!segreto || punto <= 0) return null;
  const payload = token.slice(0, punto);
  const attesa = firma(segreto, payload);
  const data = daB64url(token.slice(punto + 1));
  if (data.length !== attesa.length || !timingSafeEqual(data, attesa)) return null;
  const [evento, iscrizione] = daB64url(payload).toString('utf8').split(':');
  return evento === eventId && iscrizione ? iscrizione : null;
}
