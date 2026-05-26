import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';

export const POST = withErrorHandling(async (request) => {
  await logAdminAction({ request, action: 'ADMIN_LOGOUT' });

  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_session', '', {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
});
