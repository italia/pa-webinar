import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { jwtVerify } from 'jose';

import { locales, defaultLocale } from '@/i18n/config';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

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
    return response;
  }

  // Moderator magic links: allow access to event-specific admin pages
  // if a valid UUID token is provided. The actual token is verified
  // server-side by the page/API, not here — we only gate on format.
  if (ADMIN_EVENT_RE.test(pathname)) {
    const tokenParam = request.nextUrl.searchParams.get('token');
    if (tokenParam && UUID_RE.test(tokenParam)) {
      return response;
    }
  }

  const valid = await isValidAdminSession(request);
  if (!valid) {
    const locale = pathname.startsWith('/en') ? 'en' : 'it';
    const loginUrl = new URL(`/${locale}/admin/login`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
