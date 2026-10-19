/**
 * GET /api/avatar/person/[id] — la foto di una persona dell'evento, come
 * immagine (EventPersonPhoto, vedi lib/events/person-photo).
 *
 * L'id è un UUID che si conosce dalla pagina pubblica dell'evento, dove la
 * foto compare solo se la persona è presentata, o dal wizard di chi la
 * gestisce. Stesse intestazioni della foto della sala (/api/avatar/photo):
 * un'immagine e basta, leggibile anche da un'altra origine.
 */

import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  // Un'immagine e basta: niente script, niente risorse caricate da lei.
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'cross-origin',
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return new Response(null, { status: 404, headers: HEADERS });
  const foto = await prisma.eventPersonPhoto.findUnique({
    where: { id },
    select: { bytes: true, contentType: true },
  });
  if (!foto) {
    // Tolta: la pagina ricade sulle iniziali. Breve cache del 404.
    return new Response(null, {
      status: 404,
      headers: { ...HEADERS, 'Cache-Control': 'private, max-age=60' },
    });
  }
  return new Response(new Uint8Array(foto.bytes), {
    headers: {
      ...HEADERS,
      'Content-Type': foto.contentType,
      // L'id cambia a ogni nuova foto. Cache solo nel browser, e per un'ora:
      // una foto tolta smette presto di comparire anche a chi l'aveva vista,
      // e nessuna cache condivisa la conserva.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
