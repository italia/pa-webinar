import { createHmac, timingSafeEqual } from 'crypto';

import { tryGetAppSecret } from '@/lib/auth/app-secret';

/**
 * Un link firmato che lega un'iscrizione a un evento per un solo scopo (la
 * valutazione, la visione della registrazione). Non e' il token d'iscrizione,
 * che apre la sala e i pannelli: chi riceve il link inoltrato puo' fare solo
 * quella cosa.
 *
 * Formato: `<payload base64url>.<firma base64url>`, payload
 * `<eventId>:<registrationId>`. Lo scopo entra nella firma, cosi' un link di
 * uno scopo non vale per un altro. Non scade: la finestra la decide chi lo
 * verifica.
 */

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const daB64url = (s: string) =>
  Buffer.from(
    s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4),
    'base64'
  );

function firma(segreto: string, scopo: string, payload: string): Buffer {
  return createHmac('sha256', segreto)
    .update(scopo + payload)
    .digest();
}

export function issueScopedLinkToken(
  scopo: string,
  eventId: string,
  registrationId: string
): string | null {
  const segreto = tryGetAppSecret();
  if (!segreto) return null;
  const payload = b64url(Buffer.from(`${eventId}:${registrationId}`, 'utf8'));
  return `${payload}.${b64url(firma(segreto, scopo, payload))}`;
}

/** L'iscrizione del link, se il token e' valido, di questo scopo e di questo evento. */
export function verifyScopedLinkToken(
  scopo: string,
  token: string,
  eventId: string
): string | null {
  const segreto = tryGetAppSecret();
  const punto = token.indexOf('.');
  if (!segreto || punto <= 0) return null;
  const payload = token.slice(0, punto);
  const attesa = firma(segreto, scopo, payload);
  const data = daB64url(token.slice(punto + 1));
  if (data.length !== attesa.length || !timingSafeEqual(data, attesa)) return null;
  const [evento, iscrizione] = daB64url(payload).toString('utf8').split(':');
  return evento === eventId && iscrizione ? iscrizione : null;
}
