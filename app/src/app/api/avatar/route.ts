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

/**
 * L'esito va distinto, non ridotto a «non c'è immagine».
 *
 * `d=404` chiede a Gravatar di rispondere 404 quando quell'indirizzo non ha un
 * avatar: è una risposta CERTA e definitiva, e merita la cache lunga. Un
 * timeout o un errore di rete somigliano al 404 nel risultato — iniziali — ma
 * sono transitori, e metterli in cache un giorno intero congelerebbe la panne.
 * Confonderli rendeva la cache lunga irraggiungibile: chi NON ha un Gravatar è
 * il caso comune, e ogni avatar sarebbe stato richiesto una volta al minuto da
 * tutta la sala.
 */
type GravatarOutcome =
  | { kind: 'found'; res: Response }
  | { kind: 'absent' }
  | { kind: 'unreachable' };

async function tryGravatar(
  md5Hash: string,
  size: number,
): Promise<GravatarOutcome> {
  const url = `${GRAVATAR_BASE}/${md5Hash}?s=${size}&d=404`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(GRAVATAR_TIMEOUT_MS),
    });
    if (res.ok) return { kind: 'found', res };
    if (res.status === 404) return { kind: 'absent' };
    return { kind: 'unreachable' };
  } catch {
    // Timeout o errore di rete.
    return { kind: 'unreachable' };
  }
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
  //
  // In `catch` si NEGA. Questa route non aveva alcuna dipendenza dal database,
  // e Jitsi ne diffonde l'URL a tutta la sala: durante un riavvio di Postgres
  // ogni riquadro mostrerebbe un errore invece di una faccia. Senza risposta
  // dalle impostazioni, l'avatar generato è sempre una risposta valida — e nel
  // dubbio non si contatta un terzo.
  let gravatarAllowed = false;
  let settingsUnknown = false;
  if (hash) {
    try {
      gravatarAllowed = (await getSettings()).gravatarEnabled;
    } catch (err) {
      gravatarAllowed = false;
      settingsUnknown = true;
      console.warn('[avatar] impostazioni non leggibili, Gravatar saltato', err);
    }
  }

  let gravatarUnreachable = false;
  if (hash && gravatarAllowed) {
    const outcome = await tryGravatar(hash, size);
    gravatarUnreachable = outcome.kind === 'unreachable';
    if (outcome.kind === 'found') {
      const body = await outcome.res.arrayBuffer();
      const contentType =
        outcome.res.headers.get('content-type') || 'image/jpeg';
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
      // Un giorno di cache va bene per una risposta CERTA: nessun Gravatar per
      // questo indirizzo, o nessun indirizzo affatto. Ma se le impostazioni non
      // erano leggibili, o gravatar.com non ha risposto, questa è una risposta
      // di RIPIEGO: tenerla un giorno farebbe sopravvivere alla panne — un
      // timeout di due secondi durante l'ondata di ingressi — un giorno intero
      // di avatar con le iniziali, senza modo di invalidarli. Un minuto regge
      // l'ondata e guarisce da solo.
      'Cache-Control':
        settingsUnknown || gravatarUnreachable
          ? 'public, max-age=60, s-maxage=60'
          : 'public, max-age=86400, s-maxage=86400',
      ...CORS_HEADERS,
    },
  });
}
