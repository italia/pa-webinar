import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { jwtVerify } from 'jose';

import { locales, defaultLocale, type Locale } from '@/i18n/config';
import { getPublicEnv } from '@/lib/env';

const LOCALE_SEGMENT = locales.join('|');

const ADMIN_PATH_RE = new RegExp(`^/(?:${LOCALE_SEGMENT})/admin(?:/|$)`);
const ADMIN_LOGIN_RE = new RegExp(`^/(?:${LOCALE_SEGMENT})/admin/login(?:/|$)`);
const ADMIN_EVENT_RE = new RegExp(`^/(?:${LOCALE_SEGMENT})/admin/eventi/[^/]+(?:/[^/]+)?$`);
const LOCALE_PREFIX_RE = new RegExp(`^/(${LOCALE_SEGMENT})(?:/|$)`);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      "font-src 'self' data:",
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

function getEnabledLocales(request: NextRequest): Locale[] {
  const cookie = request.cookies.get('enabled_locales')?.value;
  if (cookie) {
    try {
      const parsed = JSON.parse(cookie) as string[];
      const valid = parsed.filter((l): l is Locale =>
        locales.includes(l as Locale),
      );
      if (valid.length > 0) return valid;
    } catch { /* ignore malformed cookie */ }
  }
  return [...locales];
}

function getRuntimeDefaultLocale(request: NextRequest): Locale {
  const cookie = request.cookies.get('default_locale')?.value;
  if (cookie && locales.includes(cookie as Locale)) {
    return cookie as Locale;
  }
  return defaultLocale;
}

function extractLocaleFromPath(pathname: string): Locale | null {
  const match = LOCALE_PREFIX_RE.exec(pathname);
  if (match && match[1]) {
    return match[1] as Locale;
  }
  return null;
}

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
  const { pathname } = request.nextUrl;

  const requestedLocale = extractLocaleFromPath(pathname);
  if (requestedLocale) {
    const enabled = getEnabledLocales(request);
    if (!enabled.includes(requestedLocale)) {
      const rtDefault = getRuntimeDefaultLocale(request);
      const rest = pathname.replace(LOCALE_PREFIX_RE, `/${rtDefault}/`);
      return NextResponse.redirect(new URL(rest, request.url));
    }
  }

  const response = intlMiddleware(request);

  if (!ADMIN_PATH_RE.test(pathname) || ADMIN_LOGIN_RE.test(pathname)) {
    return applySecurityHeaders(response);
  }

  if (ADMIN_EVENT_RE.test(pathname)) {
    const tokenParam = request.nextUrl.searchParams.get('token');
    if (tokenParam && UUID_RE.test(tokenParam)) {
      return applySecurityHeaders(response);
    }
  }

  const valid = await isValidAdminSession(request);
  if (!valid) {
    const pathLocale = extractLocaleFromPath(pathname);
    const locale = pathLocale ?? getRuntimeDefaultLocale(request);
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
