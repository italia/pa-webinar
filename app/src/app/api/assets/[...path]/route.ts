/**
 * Asset serving: pubblico per default, protetto per gli allegati della chat.
 *
 * Uploaded files (logos, event covers, materials) are written to a PRIVATE
 * object-storage container — the storage account has public blob access
 * disabled. We can't hand out bare blob URLs (they'd 404/AuthFail in the
 * browser), so this route streams the blob through a SHORT-LIVED, server-side
 * read SAS:
 *   - the persisted URL stays stable (/api/assets/<key>) — no SAS baked into
 *     the DB, so a key rotation doesn't break every event cover;
 *   - no SAS is ever exposed to the client;
 *   - the response is a plain 200 with the bytes, so it works as an <img src>
 *     AND as an og:image for social/preview crawlers (which often don't follow
 *     redirects to signed URLs).
 *
 * Only the `assets/` key prefix is reachable (the prefix produced by
 * buildAssetKey), so this can never be used to read recordings or other blobs.
 *
 * ── DUE FAMIGLIE DI ASSET ──────────────────────────────────────────────────
 *
 * 1. Asset pubblici (logo, favicon, copertine, watermark, audio della sala
 *    d'attesa, materiali): restano pubblici. Sono già esposti in pagine
 *    pubbliche, in og:image e nelle email — un gate qui li romperebbe.
 *
 * 2. Allegati della chat (`assets/chat/<eventId>/…`, vedi buildChatAssetKey):
 *    PROTETTI. In un webinar PA la chat contiene documenti, e finora l'unica
 *    difesa era che l'UUID non fosse indovinabile: un URL copiato dalla stanza
 *    (o un vecchio link inoltrato) apriva il file a chiunque, per sempre, anche
 *    a evento concluso — mentre il messaggio che lo conteneva era già dietro
 *    autenticazione. Il gate è `authorizeChatRead`, lo STESSO di GET /chat e
 *    dello stream SSE: chi può leggere i messaggi vede gli allegati, gli altri
 *    no. Nessuna regola parallela da tenere allineata a mano.
 *
 * Il token del lettore arriva in `?token=` oltre che in Authorization: un
 * <img src> e un <a href> non possono portare un header. È lo stesso
 * compromesso già in uso sui magic link (extractModeratorToken). Un ospite non
 * ha token e passa dal ramo anonimo del gate — cioè vede l'allegato solo
 * finestra-ospite aperta (LIVE, evento senza password), esattamente come vede
 * il messaggio.
 *
 * SCELTA CONSAPEVOLE — allegati caricati PRIMA di questo cambio: le loro chiavi
 * stanno sotto `assets/image|document/…`, indistinguibili da un logo, e restano
 * quindi capability-URL pubbliche. Non li irrigidiamo perché non si può farlo
 * senza un gate su OGNI asset (una query DB per ogni richiesta di logo) oppure
 * riscrivendo chiavi in storage e righe ChatMessage: i link già inviati
 * continuano a funzionare, per scelta. Il nuovo namespace chiude la porta da
 * qui in avanti; l'insieme residuo è finito e non cresce.
 *
 * Security: the container is private but this route is public. We always send
 * `X-Content-Type-Options: nosniff` (so e.g. text/plain can't be sniffed as
 * HTML) and force `Content-Disposition: attachment` for anything that isn't a
 * known inline-safe type. This neutralises the stored-XSS vector from an
 * uploaded `image/svg+xml` (an SVG can carry <script>): as an attachment it
 * downloads instead of rendering as a document on direct navigation, while
 * `<img src>`/og:image embedding is unaffected (disposition applies only to
 * top-level navigations, and an SVG loaded via <img> can't execute scripts).
 */

import type { NextRequest } from 'next/server';

import { extractModeratorToken } from '@/lib/auth/moderator';
import { authorizeChatRead } from '@/lib/chat/read-access';
import { AppError } from '@/lib/errors';
import { getFilesStorage } from '@/lib/storage';
import { chatAssetEventId, isChatAssetPath } from '@/lib/utils/asset-key';
import { normalizeMimeType } from '@/lib/utils/mime-sniff';

export const dynamic = 'force-dynamic';

// "Active document" types the browser can execute as a same-origin document
// (script in SVG, HTML, XSLT-driven XML). With nosniff already set, these are
// the only types that pose a stored-XSS risk on direct navigation, so we force
// them to download. Everything else (raster images, PDF, audio, plain text,
// Office docs, …) keeps its normal inline/download behaviour.
const ACTIVE_DOCUMENT_TYPES = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
  // Unknown/opaque bytes: safest to download rather than let the browser guess.
  'application/octet-stream',
]);

function mustForceDownload(contentType: string): boolean {
  return ACTIVE_DOCUMENT_TYPES.has(normalizeMimeType(contentType));
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (!Array.isArray(path) || path.length === 0) {
    return new Response('Not found', { status: 404 });
  }

  const sub = path.join('/');
  // Defense-in-depth: no traversal, no absolute paths, only the assets/ prefix
  // (re-added below) is ever served.
  if (sub.includes('..') || sub.includes('\\') || sub.startsWith('/')) {
    return new Response('Bad request', { status: 400 });
  }
  const key = `assets/${sub}`;

  // Allegati di chat: stesso gate della lettura dei messaggi. Prima di
  // qualsiasi accesso allo storage, così a un lettore non autorizzato non viene
  // nemmeno emesso il SAS.
  const gated = isChatAssetPath(sub);
  if (gated) {
    const eventId = chatAssetEventId(sub);
    // Namespace protetto ma percorso che non nomina un evento valido: non
    // esiste un blob così, e comunque non sapremmo su cosa autorizzare.
    if (!eventId) return new Response('Not found', { status: 404 });
    try {
      await authorizeChatRead(eventId, extractModeratorToken(request));
    } catch (err) {
      // authorizeChatRead distingue 404 (evento inesistente) da 403 (non puoi
      // leggere questa chat). Qualunque ALTRO errore resta un rifiuto — un gate
      // che si apre quando il DB non risponde non è un gate — ma va loggato:
      // altrimenti un guasto di infrastruttura si presenta come "permesso
      // negato" e si cerca il bug nel posto sbagliato.
      if (!(err instanceof AppError)) {
        console.error('[assets] chat access gate failed unexpectedly:', err);
      }
      const status = err instanceof AppError && err.statusCode === 404 ? 404 : 403;
      return new Response(status === 404 ? 'Not found' : 'Forbidden', { status });
    }
  }

  const storage = getFilesStorage();
  if (!storage) return new Response('Not found', { status: 404 });

  let sasUrl: string;
  try {
    sasUrl = await storage.getDownloadUrl(key, { expiresInMinutes: 10 });
  } catch {
    return new Response('Not found', { status: 404 });
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(sasUrl);
  } catch {
    return new Response('Upstream error', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response('Not found', { status: 404 });
  }

  const contentType =
    upstream.headers.get('content-type') ?? 'application/octet-stream';

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  // Never let the browser second-guess the declared type (blocks text→HTML
  // sniffing); and force a download for active-document types (SVG/HTML/XML)
  // so a malicious upload can't run as a same-origin document on direct
  // navigation. Images/PDF/audio/text/Office keep their normal behaviour.
  headers.set('X-Content-Type-Options', 'nosniff');
  if (mustForceDownload(contentType)) {
    headers.set('Content-Disposition', 'attachment');
  }
  // Asset keys embed a random UUID → the bytes for a given key never change,
  // so they're safe to cache aggressively at the browser/CDN.
  // Gli allegati di chat NO: `public` autorizzerebbe una cache condivisa (CDN,
  // proxy) a restituire il documento a chi non ha superato il gate, e la
  // risposta dipende dal token/cookie del richiedente. Il controllo va rifatto
  // a ogni richiesta, perché il diritto a leggere scade con l'evento.
  headers.set(
    'Cache-Control',
    gated ? 'private, no-store' : 'public, max-age=31536000, immutable',
  );

  return new Response(upstream.body, { status: 200, headers });
}
