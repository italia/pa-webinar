import type { NextResponse } from 'next/server';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

/**
 * Admin session lifetime (JWT `exp`) — the ceiling for an IDLE session, i.e.
 * how long a walked-away workstation stays AUTHORIZED. AdminSessionKeepAlive
 * slides this via POST /api/admin/refresh while an admin is actively working
 * (tab visible + recent activity), so an active operator never expires
 * mid-session; only a genuinely idle session decays to this ceiling.
 */
export const ADMIN_SESSION_TTL_SECONDS = 6 * 60 * 60;

/**
 * Cookie max-age, longer than the JWT lifetime. Access is always bounded by
 * the JWT `exp` inside the token, never by this max-age: a cookie that outlives
 * its token grants nothing. Logout clears it explicitly, and the keepalive
 * re-sets it on every slide, so an active session's cookie never decays.
 */
export const ADMIN_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Vera se la sessione e' di un amministratore: la chiave dell'istanza o un
 * account dello staff con ruolo ADMIN, attivo. Passa da `getStaffSession`,
 * cosi' un amministratore disattivato o degradato perde l'accesso subito
 * su ogni rotta, non alla scadenza del cookie.
 */
export async function isAdminAuthenticated(
  cookies: ReadonlyRequestCookies,
): Promise<boolean> {
  const { getStaffSession } = await import('./staff-session');
  return (await getStaffSession(cookies))?.role === 'admin';
}

/**
 * Write the admin_session cookie with our standard hardening flags.
 * Reused by both the login mint path and the refresh re-mint path.
 */
export function setAdminSessionCookie(
  response: NextResponse,
  token: string,
): void {
  response.cookies.set('admin_session', token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    // Cookie outlives the JWT (see ADMIN_COOKIE_MAX_AGE_SECONDS) so a lapsed
    // admin session stays detectable as "present-but-invalid". Access is still
    // bounded by the JWT `exp` inside the token, not by this max-age.
    maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
}
