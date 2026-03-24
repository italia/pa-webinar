import { type NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';

export async function POST(request: NextRequest) {
  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || body.key !== adminKey) {
    return NextResponse.json({ error: 'invalid_key' }, { status: 401 });
  }

  const secret = new TextEncoder().encode(process.env.APP_SECRET);
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);

  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_session', token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
