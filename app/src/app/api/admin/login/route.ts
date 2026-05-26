import { NextResponse, type NextRequest } from 'next/server';
import { SignJWT } from 'jose';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, AppError } from '@/lib/errors';
import { constantTimeEqual } from '@/lib/auth/moderator';
import { requireAppSecretKey } from '@/lib/auth/app-secret';
import { logAdminAction } from '@/lib/audit/admin-audit';

export const POST = withErrorHandling(async (request: NextRequest) => {
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
    .setExpirationTime('24h')
    .sign(secret);

  await logAdminAction({ request, action: 'ADMIN_LOGIN' });

  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_session', token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
});
