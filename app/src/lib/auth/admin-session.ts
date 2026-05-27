import { jwtVerify } from 'jose';
import type { NextResponse } from 'next/server';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import { tryGetAppSecret } from './app-secret';

/**
 * Admin session lifetime — short enough that a walked-away laptop
 * doesn't keep an admin authenticated all day, long enough that a
 * typical event-management session doesn't get interrupted. The admin
 * UI is expected to call POST /api/admin/refresh ahead of expiry to
 * extend the session while the operator is actively working.
 */
export const ADMIN_SESSION_TTL_SECONDS = 4 * 60 * 60;

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
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
}
