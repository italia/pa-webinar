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
// Event pages under /admin reachable by a NON-admin event moderator via magic
// link (moderatorLink = /admin/events/{id}?token=…): the shared management page
// and its /edit. They authenticate on the event moderator token, not the admin
// session (see events/[id]/page.tsx + edit/page.tsx). The id segment MUST be a
// UUID — this deliberately EXCLUDES the sibling /admin/events/new create wizard,
// which has no token auth of its own and must stay behind the admin session
// (otherwise ?token=<any-uuid> would leak the wizard's templates/settings).
const ADMIN_EVENT_RE = new RegExp(
  `^/(?:${LOCALE_SEGMENT})/admin/(?:events|eventi)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:/[^/]+)?$`,
  'i',
);
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

/**
 * Generate a fresh per-request nonce (16 random bytes, base64). Used in
 * the CSP `script-src` directive AND surfaced to Server Components via
 * the `x-nonce` request header so they can attach it to any inline
 * <Script> tags that Next.js inserts (Next propagates the nonce
 * automatically when it sees the header).
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}

function applySecurityHeaders(
  response: NextResponse,
  nonce: string,
): NextResponse {
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
      // script-src: nonce-based + strict-dynamic. The nonce is set on
      // every Next.js-emitted inline script (App Router streaming
      // chunks, hydration markers), and strict-dynamic lets those
      // trusted scripts load their own children without further
      // whitelisting. We keep https://${jitsiDomain} for the IFrame
      // API external script. Removes 'unsafe-inline' — the historic
      // XSS amplifier in the policy.
      //
      // DEV-ONLY: `next dev` (HMR + React Refresh + webpack eval modules)
      // requires 'unsafe-eval' to execute the client bundle. Without it
      // the browser blocks the dev runtime and the app never hydrates —
      // every page renders as static HTML with no interactivity. We add
      // 'unsafe-eval' exclusively when NODE_ENV !== 'production' so the
      // production policy stays strict (nonce + strict-dynamic, no eval).
      process.env.NODE_ENV === 'production'
        ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: https://${jitsiDomain}`
        : `script-src 'self' 'unsafe-eval' 'nonce-${nonce}' 'strict-dynamic' https: https://${jitsiDomain}`,
      // style-src keeps 'unsafe-inline' as an architectural trade-off:
      // React renders `style={{...}}` props as DOM `style="..."`
      // attributes, which CSP treats as inline styles. The codebase
      // currently has ~1k such occurrences across ~60 files. Two
      // viable removal paths, both out of scope for the middleware:
      //   (1) refactor every inline style to className + CSS module
      //       / Bootstrap-Italia utility (multi-sprint effort);
      //   (2) move to a CSS-in-JS library that generates a stylesheet
      //       (linaria, vanilla-extract) — also large.
      // Note: nonce on style-src doesn't help here because the nonce
      // attribute only applies to `<style>` blocks, not to inline
      // style attributes (CSP3 'unsafe-hashes' would, but each style
      // attribute would need its own hash and React renders
      // dynamic values — hashes would mismatch at runtime).
      // See docs/SECURITY-CSP.md for the migration plan.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https://i.ytimg.com",
      `connect-src ${connectSrc}`,
      `media-src ${mediaSrc}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
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

  // Generate a per-request nonce and surface it to Server Components via
  // the x-nonce request header. Next.js picks this up automatically and
  // attaches it to every inline <script> it emits.
  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = intlMiddleware(request);
  // Carry the x-nonce forward on the response request so downstream
  // Server Components see it via headers().get('x-nonce').
  response.headers.set('x-nonce', nonce);

  if (!ADMIN_PATH_RE.test(pathname) || ADMIN_LOGIN_RE.test(pathname)) {
    return applySecurityHeaders(response, nonce);
  }

  // Admin-area gate. A VALID admin session (JWT signature + non-expired) lets
  // any /admin/* page through.
  const hasAdminCookie = !!request.cookies.get('admin_session')?.value;
  const validAdmin = hasAdminCookie ? await isValidAdminSession(request) : false;
  if (validAdmin) {
    return applySecurityHeaders(response, nonce);
  }

  // No valid admin session. Distinguish two very different visitors:
  //  • an EVENT MODERATOR reaching a `?token=` management/edit page via magic
  //    link — they have NO admin_session cookie at all and must keep access
  //    (bouncing them to an admin-key login they can't pass would lock them out
  //    of running their own event: moderatorLink = /admin/events/{id}?token=…);
  //  • an ADMIN whose session LAPSED — the cookie outlives the JWT (see
  //    ADMIN_COOKIE_MAX_AGE_SECONDS), so it is still PRESENT though invalid;
  //    that "present-but-invalid" state means an admin, and they go to login.
  const tokenParam = request.nextUrl.searchParams.get('token');
  const isModeratorTokenPage =
    ADMIN_EVENT_RE.test(pathname) &&
    !!tokenParam &&
    UUID_RE.test(tokenParam) &&
    !hasAdminCookie;
  if (isModeratorTokenPage) {
    return applySecurityHeaders(response, nonce);
  }

  const pathLocale = extractLocaleFromPath(pathname);
  const locale = pathLocale ?? getRuntimeDefaultLocale(request);
  const loginUrl = new URL(`/${locale}/admin/login`, request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
