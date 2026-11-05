import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { getStaffSession } from '@/lib/auth/staff-session';

export const POST = withErrorHandling(async (request) => {
  // Si esce sempre, anche col database giu', ma nel registro scrive solo chi aveva
  // una sessione: la rotta e' aperta, e chiunque potrebbe riempirlo.
  const sessione = await getStaffSession(await cookies()).catch((err: unknown) => {
    console.error('[admin/logout] lettura della sessione fallita:', err);
    return null;
  });
  if (sessione) {
    await logAdminAction({ request, action: 'ADMIN_LOGOUT' });
  }

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
