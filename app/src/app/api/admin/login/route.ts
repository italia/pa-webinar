import { NextResponse, type NextRequest } from 'next/server';
import { SignJWT } from 'jose';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, AppError, RateLimitError } from '@/lib/errors';
import { constantTimeEqual } from '@/lib/auth/moderator';
import { requireAppSecretKey } from '@/lib/auth/app-secret';
import { logAdminAction } from '@/lib/audit/admin-audit';
import {
  ADMIN_SESSION_TTL_SECONDS,
  setAdminSessionCookie,
} from '@/lib/auth/admin-session';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const POST = withErrorHandling(async (request: NextRequest) => {
  // Cap admin-key brute force. 5/min/IP is well above any legitimate
  // re-login pattern (operator typed the key wrong twice) and far
  // below what's useful for an enumeration attack.
  const ip = getClientIp(request);
  const rl = rateLimit(`admin-login:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request) as { key?: string };

  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || !constantTimeEqual(body.key ?? '', adminKey)) {
    throw new UnauthorizedError('invalid_key');
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

  await logAdminAction({ request, action: 'ADMIN_LOGIN' });

  const response = NextResponse.json({ success: true });
  setAdminSessionCookie(response, token);
  return response;
});
