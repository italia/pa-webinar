/**
 * Public asset serving.
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
  _request: NextRequest,
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
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(upstream.body, { status: 200, headers });
}
