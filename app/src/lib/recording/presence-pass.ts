// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { createHmac, timingSafeEqual } from 'crypto';

import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import { tryGetAppSecret } from '@/lib/auth/app-secret';

/**
 * Il pass di presenza di una chiamata rapida: un cookie HttpOnly firmato che
 * il browser di chi era in sala mentre si registrava riceve dalla rotta
 * `/api/events/[slug]/recording/presence`. Dopo la chiamata, con il pass, il
 * link della chiamata mostra la registrazione (lib/recording/audience), finche'
 * la chiamata e' conservata. Vale per chi c'era, che abbia acconsentito o no a
 * comparire nel video; niente email, niente link da inoltrare.
 *
 * Il valore e' `<scadenza>.<firma>`: la scadenza in secondi epoch e una firma
 * HMAC-SHA256 (troncata a 128 bit) di scopo, evento e scadenza. L'evento sta
 * nel nome del cookie e nella firma, non nel valore: un pass non vale per un
 * altro evento ne' oltre la propria scadenza, anche se il browser tiene il
 * cookie. Corto di proposito: chi partecipa a molte chiamate registrate ne
 * accumula uno per chiamata, e tutti viaggiano con ogni richiesta finche'
 * non scadono.
 */

const SCOPO = 'presenza|';
const BYTE_FIRMA = 16;

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function firma(segreto: string, eventId: string, scadenzaSec: string): Buffer {
  return createHmac('sha256', segreto)
    .update(`${SCOPO}${eventId}|${scadenzaSec}`)
    .digest()
    .subarray(0, BYTE_FIRMA);
}

const GIORNO_MS = 24 * 60 * 60 * 1000;

/** Il tetto dei browser alla durata di un cookie. */
const MAX_AGE_TETTO_SECONDI = 400 * 24 * 60 * 60;

export function presencePassCookieName(eventId: string): string {
  return `rec_pass_${eventId}`;
}

/**
 * Fin quando la chiamata e' conservata: la pulizia dei dati la cancella dopo
 * `dataRetentionDays` dal piu' tardo fra la fine prevista e l'ultima attivita'
 * (lib/gdpr/cleanup-selection), e chi la registra adesso e' l'ultima attivita'.
 */
export function scadenzaPass(
  evento: { endsAt: Date; dataRetentionDays: number },
  adesso: Date = new Date()
): Date {
  const da = Math.max(evento.endsAt.getTime(), adesso.getTime());
  return new Date(da + evento.dataRetentionDays * GIORNO_MS);
}

export function issuePresencePass(eventId: string, scadenza: Date): string | null {
  const segreto = tryGetAppSecret();
  if (!segreto) return null;
  const scadenzaSec = String(Math.floor(scadenza.getTime() / 1000));
  return `${scadenzaSec}.${b64url(firma(segreto, eventId, scadenzaSec))}`;
}

/** Se il token e' un pass valido e non scaduto per questo evento. */
export function verifyPresencePass(
  token: string | undefined,
  eventId: string,
  adesso: Date = new Date()
): boolean {
  const segreto = tryGetAppSecret();
  if (!token || !segreto) return false;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return false;
  const attesa = b64url(firma(segreto, eventId, m[1]!));
  const data = Buffer.from(m[2]!);
  if (data.length !== attesa.length || !timingSafeEqual(data, Buffer.from(attesa)))
    return false;
  return Number(m[1]) * 1000 > adesso.getTime();
}

/** Se la richiesta porta il pass di presenza di questo evento. */
export function haPassDiPresenza(
  cookieStore: ReadonlyRequestCookies,
  eventId: string,
  adesso: Date = new Date()
): boolean {
  return verifyPresencePass(
    cookieStore.get(presencePassCookieName(eventId))?.value,
    eventId,
    adesso
  );
}

/** L'header `Set-Cookie` del pass. */
export function buildPresencePassSetCookie(
  eventId: string,
  token: string,
  scadenza: Date,
  adesso: Date = new Date()
): string {
  const maxAge = Math.min(
    MAX_AGE_TETTO_SECONDI,
    Math.max(0, Math.floor((scadenza.getTime() - adesso.getTime()) / 1000))
  );
  return [
    `${presencePassCookieName(eventId)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}
