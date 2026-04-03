import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { jwtVerify } from 'jose';

import { locales, defaultLocale } from '@/i18n/config';
import { getPublicEnv } from '@/lib/env';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

function applySecurityHeaders(response: NextResponse): NextResponse {
  const jitsiDomain = getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN');

  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    `camera=(self "https://${jitsiDomain}"), microphone=(self "https://${jitsiDomain}"), display-capture=(self "https://${jitsiDomain}"), geolocation=()`,
  );
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `frame-src 'self' https://${jitsiDomain}`,
      `script-src 'self' 'unsafe-inline' https://${jitsiDomain}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob:",
      `connect-src 'self' https://${jitsiDomain} wss://${jitsiDomain}`,
      "media-src 'self' blob:",
    ].join('; '),
  );
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  );

  return response;
}

const ADMIN_PATH_RE = /^\/(?:it|en)\/admin(?:\/|$)/;
const ADMIN_LOGIN_RE = /^\/(?:it|en)\/admin\/login(?:\/|$)/;
const ADMIN_EVENT_RE = /^\/(?:it|en)\/admin\/eventi\/[^/]+(?:\/[^/]+)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function isValidAdminSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get('admin_session')?.value;
  if (!token) return false;

  const appSecret = process.env.APP_SECRET;
  if (!appSecret) return false;

  try {
    const secret = new TextEncoder().encode(appSecret);
    const { payload } = await jwtVerify(token, secret);
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

export default async function middleware(request: NextRequest) {
  const response = intlMiddleware(request);
  const { pathname } = request.nextUrl;

  if (!ADMIN_PATH_RE.test(pathname) || ADMIN_LOGIN_RE.test(pathname)) {
    return applySecurityHeaders(response);
  }

  // Moderator magic links: allow access to event-specific admin pages
  // if a valid UUID token is provided. The actual token is verified
  // server-side by the page/API, not here — we only gate on format.
  if (ADMIN_EVENT_RE.test(pathname)) {
    const tokenParam = request.nextUrl.searchParams.get('token');
    if (tokenParam && UUID_RE.test(tokenParam)) {
      return applySecurityHeaders(response);
    }
  }

  const valid = await isValidAdminSession(request);
  if (!valid) {
    const locale = pathname.startsWith('/en') ? 'en' : 'it';
    const loginUrl = new URL(`/${locale}/admin/login`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  return applySecurityHeaders(response);
}

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
