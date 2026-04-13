import { type NextRequest, NextResponse } from 'next/server';

import { generateAvatarSvg } from '@/lib/avatar';

/**
 * Smart avatar proxy: Gravatar → custom SVG fallback (BI palette).
 *
 * GET /api/avatar?name=Raff&size=200
 * GET /api/avatar?name=Raff&gh=a1b2c3...&size=200
 *
 * `gh` is the pre-computed MD5 hash of the email (Gravatar format).
 * No raw email ever reaches this endpoint — GDPR safe.
 *
 * When `gh` is provided, tries Gravatar first (server-side proxy so
 * disableThirdPartyRequests in Jitsi doesn't block it). Falls back to
 * our SVG generator with Designers Italia / Bootstrap Italia colors.
 *
 * NOTE: The Jitsi JWT now uses inline data URIs (see lib/avatar.ts)
 * to bypass CSP. This HTTP route is kept for email templates and
 * other contexts that need a fetchable URL.
 */

const GRAVATAR_BASE = 'https://www.gravatar.com/avatar';
const GRAVATAR_TIMEOUT_MS = 2000;

async function tryGravatar(
  md5Hash: string,
  size: number,
): Promise<Response | null> {
  const url = `${GRAVATAR_BASE}/${md5Hash}?s=${size}&d=404`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(GRAVATAR_TIMEOUT_MS),
    });
    if (res.ok) return res;
  } catch {
    // Timeout or network error — fall through to SVG
  }
  return null;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const name = searchParams.get('name') || 'User';
  const gh = searchParams.get('gh');
  const size = Math.min(
    Math.max(Number(searchParams.get('size') || '200'), 32),
    512,
  );

  if (gh && /^[0-9a-f]{32}$/i.test(gh)) {
    const gravatar = await tryGravatar(gh, size);
    if (gravatar) {
      const body = await gravatar.arrayBuffer();
      const contentType =
        gravatar.headers.get('content-type') || 'image/jpeg';
      return new NextResponse(body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          ...CORS_HEADERS,
        },
      });
    }
  }

  const svg = generateAvatarSvg(name, size);
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      ...CORS_HEADERS,
    },
  });
}
