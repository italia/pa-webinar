import { type NextRequest, NextResponse } from 'next/server';

import { generateAvatarSvg, parseAvatarSize } from '@/lib/avatar';
import { readGravatarRef } from '@/lib/gravatar-ref';
import { getSettings } from '@/lib/settings';

/**
 * Smart avatar proxy: Gravatar → custom SVG fallback (BI palette).
 *
 * GET /api/avatar?name=Raff&size=200
 * GET /api/avatar?name=Raff&gh=a1b2c3...&size=200
 * GET /api/avatar?name=Raff&g=<encrypted-hash>&size=200
 *
 * Two ways to point it at a Gravatar:
 *   `gh` — the plain MD5 of the email (Gravatar's own format), kept for the
 *          email templates that already build it. Those URLs live in a message
 *          addressed to the person themselves, so the hash is not shown to
 *          anyone else;
 *   `g`  — the same MD5, ENCRYPTED with our PII key (see lib/gravatar-ref).
 *          This is the form the Jitsi JWT uses, because Jitsi broadcasts the
 *          avatar URL in presence to the whole room: a bare hash there would be
 *          a re-identification oracle (addresses carry too little entropy, so
 *          any attendee could test nome.cognome@comune.it against the others).
 *
 * Either way the request to gravatar.com is made HERE, by the server, with
 * `d=404` so that anyone without a Gravatar keeps the generated initials
 * instead of a stranger's default drawing. The participant's browser never
 * talks to gravatar.com — which is what lets docs/GDPR.md keep saying so.
 *
 * And it is made only when the ADMIN has enabled Gravatar for the instance.
 * The check lives here, not only in the callers that build the URL: this route
 * is public and unauthenticated, so without it anyone could keep using the
 * deployment as a Gravatar probe with the option switched off.
 *
 * The Jitsi JWT normally carries an inline data URI (see lib/avatar.ts); it
 * points here only when an admin has enabled Gravatar for the instance.
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
  // Encrypted hash (see the header). Tampered or stale ciphertext simply falls
  // through to the generated avatar — never an error page in place of a face.
  const ref = searchParams.get('g');
  const hash =
    (gh && /^[0-9a-f]{32}$/i.test(gh) ? gh : null) ??
    (ref ? readGravatarRef(ref) : null);
  const size = parseAvatarSize(searchParams.get('size'));

  // L'interruttore dell'amministratore vale QUI, non solo in chi costruisce
  // l'URL. docs/GDPR.md — che l'ente pubblica come informativa — promette che
  // con l'opzione spenta nessuna richiesta parte verso Gravatar: se la
  // decidesse solo il chiamante, questa route resterebbe una sonda Gravatar
  // aperta a chiunque, e quella frase sarebbe falsa. Letture in cache (60s).
  const gravatarAllowed = hash ? (await getSettings()).gravatarEnabled : false;

  if (hash && gravatarAllowed) {
    const gravatar = await tryGravatar(hash, size);
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
