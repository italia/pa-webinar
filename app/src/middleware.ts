import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { jwtVerify } from 'jose';

import { locales, defaultLocale, type Locale } from '@/i18n/config';
import { routing } from '@/i18n/routing';
import { tryGetAppSecret } from '@/lib/auth/app-secret';
import { getPublicEnv } from '@/lib/env';

const LOCALE_SEGMENT = locales.join('|');

const ADMIN_PATH_RE = new RegExp(`^/(?:${LOCALE_SEGMENT})/admin(?:/|$)`);
const ADMIN_LOGIN_RE = new RegExp(`^/(?:${LOCALE_SEGMENT})/admin/login(?:/|$)`);
const ADMIN_EVENT_RE = new RegExp(`^/(?:${LOCALE_SEGMENT})/admin/(?:events|eventi)/[^/]+(?:/[^/]+)?$`);
const LOCALE_PREFIX_RE = new RegExp(`^/(${LOCALE_SEGMENT})(?:/|$)`);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const intlMiddleware = createMiddleware(routing);

/**
 * Hosts allowed by CSP `media-src` so the inline <video> player can stream
 * recordings directly from the configured object store. We resolve them at
 * request time from the recording-storage env vars — the platform supports
 * Azure Blob, S3, GCS and MinIO, each with a different hostname shape.
 *
 * RECORDING_MEDIA_CSP_HOSTS (space-separated) overrides/extends the set
 * for operators who terminate storage behind a custom domain or CDN.
 */
function recordingMediaHosts(): string[] {
  const hosts = new Set<string>();

  const storageType = process.env.RECORDING_STORAGE_TYPE;
  if (storageType === 'azure-blob') {
    const conn = process.env.RECORDING_AZURE_CONNECTION_STRING ?? '';
    const account = conn.match(/AccountName=([^;]+)/)?.[1];
    if (account) hosts.add(`https://${account}.blob.core.windows.net`);
  } else if (storageType === 's3') {
    const endpoint = process.env.RECORDING_S3_ENDPOINT;
    if (endpoint) {
      try { hosts.add(new URL(endpoint).origin); } catch { /* ignore */ }
    } else {
      hosts.add('https://*.amazonaws.com');
    }
  } else if (storageType === 'gcs') {
    hosts.add('https://storage.googleapis.com');
  }

  const extra = process.env.RECORDING_MEDIA_CSP_HOSTS;
  if (extra) for (const h of extra.split(/\s+/).filter(Boolean)) hosts.add(h);

  return [...hosts];
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  const jitsiDomain = getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN');
  const mediaHosts = recordingMediaHosts();
  const mediaSrc = ["'self'", 'blob:', ...mediaHosts].join(' ');
  // connect-src needs the same storage hosts so the admin upload form
  // can PUT directly to the SAS URL (browser-side Azure SDK / fetch).
  const connectSrc = [
    "'self'",
    `https://${jitsiDomain}`,
    `wss://${jitsiDomain}`,
    ...mediaHosts,
  ].join(' ');

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
      "frame-ancestors 'none'",
      // Also allow YouTube for the public video-library embed (legacy
      // events host their recordings on youtube.com before we owned
      // Jibri infra). img-src mirrors this so YT preview thumbs load.
      `frame-src 'self' https://${jitsiDomain} https://www.youtube.com https://www.youtube-nocookie.com`,
      `script-src 'self' 'unsafe-inline' https://${jitsiDomain}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https://i.ytimg.com",
      `connect-src ${connectSrc}`,
      `media-src ${mediaSrc}`,
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

  const appSecret = tryGetAppSecret();
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
