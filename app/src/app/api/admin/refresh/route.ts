/**
 * POST /api/admin/refresh
 *
 * Re-mint the admin_session cookie when the caller already holds a
 * valid one. The admin UI calls this on a timer (every ~3h, well
 * inside the 4h TTL) so a working operator never gets logged out
 * mid-session — but a walked-away laptop loses access after 4h
 * because the timer doesn't fire from the server.
 *
 * Returns 401 if the current cookie is missing or invalid (no
 * implicit privilege escalation).
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';

import { withErrorHandling } from '@/lib/api-handler';
import { UnauthorizedError, AppError } from '@/lib/errors';
import { requireAppSecretKey } from '@/lib/auth/app-secret';
import {
  ADMIN_SESSION_TTL_SECONDS,
  isAdminAuthenticated,
  setAdminSessionCookie,
} from '@/lib/auth/admin-session';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (_request) => {
  const cookieStore = await cookies();
  if (!(await isAdminAuthenticated(cookieStore))) {
    throw new UnauthorizedError();
  }

  let secret: Uint8Array;
  try {
    secret = requireAppSecretKey();
  } catch {
    throw new AppError('server_misconfigured', 500, 'INTERNAL_ERROR');
  }

  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(secret);

  // No audit-log row here: this is a silent keepalive slide (called every few
  // minutes per active tab by AdminSessionKeepAlive), not a meaningful admin
  // action — logging it would flood admin_audit_log and bury real actions.

  const response = NextResponse.json({ success: true });
  setAdminSessionCookie(response, token);
  return response;
});
