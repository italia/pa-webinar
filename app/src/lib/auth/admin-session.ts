import { jwtVerify } from 'jose';
import type { NextResponse } from 'next/server';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import { tryGetAppSecret } from './app-secret';

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
 * Verify the admin_session cookie and return whether it carries a
 * valid admin role. Centralised so the middleware and individual
 * route handlers share the same check.
 */
export async function isAdminAuthenticated(
  cookies: ReadonlyRequestCookies,
): Promise<boolean> {
  const appSecret = tryGetAppSecret();
  if (!appSecret) return false;

  const token = cookies.get('admin_session')?.value;
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(appSecret);
    const { payload } = await jwtVerify(token, secret);
    return payload.role === 'admin';
  } catch {
    return false;
  }
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
