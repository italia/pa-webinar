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
 *    d'attesa, materiali): pubblici, cache lunga. Sono già esposti in pagine
 *    pubbliche, in og:image e nelle email.
 *
 * 2. Allegati della chat (`assets/chat/<eventId>/…`, buildChatAssetKey): un
 *    NAMESPACE separato, ma NON un controllo d'accesso. La difesa è quella
 *    documentata di una capability-URL: UUID non indovinabile, blob cancellato
 *    alla moderazione e alla retention (un URL trapelato diventa 404), cache
 *    breve perché una rimozione si propaghi. Un ACL vero — che rilegga lo stato
 *    vivo dell'evento a ogni richiesta — richiede un cookie con ambito sulla
 *    rotta (un <img> non manda header), ed è in ROADMAP. I due tentativi con un
 *    token nell'URL (credenziale durevole trapelata; capability autosufficiente
 *    che ignora lo stato vivo) erano entrambi peggiori del problema.
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

import { getFilesStorage } from '@/lib/storage';
import { isChatAssetPath } from '@/lib/utils/asset-key';
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
  context: { params: Promise<{ path: string[] }> }
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

  // Allegati di chat: serviti da qui, con `nosniff` e la forzatura del download
  // per i tipi attivi (vedi sotto). Il namespace `assets/chat/<eventId>/…`
  // (buildChatAssetKey) li tiene separati dagli asset pubblici — utile per la
  // retention e per l'ACL futuro — ma NON è un controllo d'accesso: come per un
  // logo, chi ha l'URL apre il file.
  //
  // SCELTA CONSAPEVOLE, e ci siamo arrivati sbagliando due volte. Un ACL vero
  // qui richiede che ogni richiesta rilegga lo stato VIVO dell'evento (chiuso?
  // password aggiunta? allegato rimosso?), e un <img>/<a> non può mandare un
  // header Authorization. Un token firmato nell'URL o è la credenziale durevole
  // del lettore (e allora trapela nella condivisione schermo) o è una
  // capability autosufficiente che ignora lo stato vivo per tutta la sua durata
  // — entrambe peggiori del problema. La forma giusta è un COOKIE con ambito
  // sulla rotta, rinnovato, riletto e ri-autorizzato dal server a ogni
  // richiesta: è una feature, ed è in ROADMAP ("ACL allegati chat via cookie").
  // Nel frattempo la difesa è quella documentata: UUID non indovinabile, blob
  // cancellato alla moderazione e alla retention (un URL trapelato diventa un
  // 404), cache breve perché una rimozione si propaghi in fretta.
  const isChatAttachment = isChatAssetPath(sub);

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

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';

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
  // Gli allegati di chat NO: sono capability-URL (nessun gate), ma `public`
  // lascerebbe che una cache CONDIVISA (CDN, proxy) continui a servire un
  // allegato rimosso dalla moderazione — a chiunque — dopo la cancellazione del
  // blob. `private` lo tiene nel solo browser di chi l'ha aperto.
  headers.set(
    'Cache-Control',
    // Chat: PRIVATA e breve. Mai `public`: una cache condivisa (CDN, proxy
    // aziendale) continuerebbe a servire un allegato rimosso dalla moderazione
    // anche dopo la cancellazione del blob, e a chiunque. `private` la tiene nel
    // solo browser di chi l'ha aperto, `max-age=60` la fa scadere in fretta. Il
    // resto (logo, copertine) ha un URL per-blob immutabile: cache lunga.
    isChatAttachment ? 'private, max-age=60' : 'public, max-age=31536000, immutable'
  );

  return new Response(upstream.body, { status: 200, headers });
}
