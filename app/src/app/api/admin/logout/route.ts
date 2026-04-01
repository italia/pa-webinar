import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';

export const POST = withErrorHandling(async () => {
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
