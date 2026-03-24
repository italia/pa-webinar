import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_session', '', {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 0,
  });

  return response;
}
