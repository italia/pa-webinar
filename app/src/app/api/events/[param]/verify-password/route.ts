/**
 * Verify the optional join password for an event.
 *
 * Flow:
 *   1. Guest lands on /events/<slug>/live with no accessToken.
 *   2. Live page sees `event.joinPasswordHash` is set and redirects to
 *      /events/<slug>/password.
 *   3. The password form posts here; on success we set a short-lived
 *      cookie `join_granted_<eventId>` that the live page checks.
 *
 * The cookie is a signed JWT carrying only `{eventId, role: 'guest'}`
 * and a 2-hour expiry — sufficient for the call's duration without
 * leaving a long-lived token around if the link is shared.
 */

import { SignJWT } from 'jose';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, RateLimitError } from '@/lib/errors';
import { verifyJoinPassword } from '@/lib/auth/password';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const GRANT_TTL_SECONDS = 2 * 60 * 60; // 2h, matches typical call length

function getAppSecret(): Uint8Array {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET not configured');
  return new TextEncoder().encode(secret);
}

function joinGrantCookieName(eventId: string): string {
  return `join_granted_${eventId}`;
}

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  // Rate-limit per IP + event so an attacker can't brute-force the
  // password by hammering this endpoint.
  const ip = getClientIp(request);
  const rl = rateLimit(`verify-password:${ip}:${slug}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, joinPasswordHash: true, status: true },
  });
  if (!event) {
    throw new AppError('Event not found', 404, 'NOT_FOUND');
  }
  if (!event.joinPasswordHash) {
    throw new AppError('Event has no password set', 400, 'BAD_REQUEST');
  }

  const body = await parseJsonBody(request) as { password?: unknown };
  const password = typeof body.password === 'string' ? body.password : '';

  if (!verifyJoinPassword(password, event.joinPasswordHash)) {
    // Return a generic 403 so the client can't distinguish "wrong
    // password" from "event missing / blocked" in timings.
    throw new AppError('Invalid password', 403, 'FORBIDDEN');
  }

  const grant = await new SignJWT({ eventId: event.id, role: 'guest' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${GRANT_TTL_SECONDS}s`)
    .sign(getAppSecret());

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': [
        `${joinGrantCookieName(event.id)}=${grant}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${GRANT_TTL_SECONDS}`,
        process.env.NODE_ENV === 'production' ? 'Secure' : '',
      ].filter(Boolean).join('; '),
    },
  });
});
