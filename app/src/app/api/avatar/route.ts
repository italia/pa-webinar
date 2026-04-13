import { type NextRequest, NextResponse } from 'next/server';

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
 * The avatar URL is injected into the Jitsi JWT via context.user.avatar.
 */

const GRAVATAR_BASE = 'https://www.gravatar.com/avatar';
const GRAVATAR_TIMEOUT_MS = 2000;

const BI_PALETTE = [
  { bg: '#004D99', fg: '#FFFFFF' },
  { bg: '#4B44CC', fg: '#FFFFFF' },
  { bg: '#08A19C', fg: '#FFFFFF' },
  { bg: '#B02E42', fg: '#FFFFFF' },
  { bg: '#00996B', fg: '#FFFFFF' },
  { bg: '#3D5A80', fg: '#FFFFFF' },
  { bg: '#6A50D3', fg: '#FFFFFF' },
  { bg: '#0077B6', fg: '#FFFFFF' },
  { bg: '#8B6AAF', fg: '#FFFFFF' },
  { bg: '#17324D', fg: '#FFFFFF' },
  { bg: '#0066CC', fg: '#FFFFFF' },
  { bg: '#2E4A62', fg: '#C9D4DE' },
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '?';
  if (parts.length === 1) return first.toUpperCase();
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

function generateSvg(name: string, size: number): string {
  const idx = hashName(name) % BI_PALETTE.length;
  const entry = BI_PALETTE[idx] ?? BI_PALETTE[0]!;
  const { bg, fg } = entry;
  const initials = getInitials(name);
  const fontSize = initials.length > 1 ? size * 0.36 : size * 0.44;
  const r = size / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bg}" stop-opacity="0.82"/>
    </linearGradient>
  </defs>
  <circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/>
  <text x="50%" y="50%" dy=".1em"
    text-anchor="middle" dominant-baseline="central"
    font-family="'Titillium Web','Segoe UI',system-ui,sans-serif"
    font-weight="600" font-size="${fontSize}px"
    fill="${fg}" fill-opacity="0.95"
    letter-spacing="1">${initials}</text>
</svg>`;
}

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

  const svg = generateSvg(name, size);
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      ...CORS_HEADERS,
    },
  });
}
