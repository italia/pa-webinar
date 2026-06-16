import { SignJWT, jwtVerify } from 'jose';

import { requireAppSecretKey, tryGetAppSecret } from '@/lib/auth/app-secret';

/**
 * Signed, HttpOnly per-event "access" cookie.
 *
 * Set at registration time, it re-establishes a registered participant's
 * identity when they return to /live WITHOUT the personal `?token=` in the
 * URL — a refresh from history, a bookmarked/shared link, or coming back via
 * the event page. Without it those cases bounce to /registration and hit the
 * 409 "already registered" loop (the post-mortem failure mode).
 *
 * It carries only `{ eventId, token: accessToken }` and expires with the
 * event, so it is not a long-lived credential. Mirrors the password flow's
 * `join_granted_<eventId>` cookie (see verify-password/route.ts).
 */

export function eventAccessCookieName(eventId: string): string {
  return `event_access_${eventId}`;
}

const MIN_TTL_SECONDS = 60 * 60; // 1h floor
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60; // 30d cap

/** Cookie lifetime: from now until a few hours past the event end, clamped. */
export function eventAccessTtlSeconds(endsAt: Date, now: number = Date.now()): number {
  const untilEnd = Math.floor((endsAt.getTime() - now) / 1000) + 6 * 60 * 60;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, untilEnd));
}

export async function signEventAccess(
  eventId: string,
  accessToken: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ eventId, token: accessToken })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${Math.max(MIN_TTL_SECONDS, Math.floor(ttlSeconds))}s`)
    .sign(requireAppSecretKey());
}

/** Build the `Set-Cookie` header value for the event-access cookie. */
export function buildEventAccessSetCookie(
  eventId: string,
  jwt: string,
  ttlSeconds: number,
): string {
  return [
    `${eventAccessCookieName(eventId)}=${jwt}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(MIN_TTL_SECONDS, Math.floor(ttlSeconds))}`,
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Verify the cookie and return the embedded accessToken, or null. Fails
 * closed (no APP_SECRET, wrong event, expired/tampered → null) so a missing
 * or bad cookie simply falls back to the normal registration redirect.
 */
export async function verifyEventAccess(
  eventId: string,
  cookieValue: string | undefined,
): Promise<string | null> {
  if (!cookieValue) return null;
  const secret = tryGetAppSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(cookieValue, new TextEncoder().encode(secret));
    if (payload.eventId !== eventId) return null;
    return typeof payload.token === 'string' ? payload.token : null;
  } catch {
    return null;
  }
}
