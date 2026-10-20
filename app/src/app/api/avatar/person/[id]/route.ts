/**
 * GET /api/avatar/person/[id] — la foto di una persona dell'evento, come
 * immagine (EventPersonPhoto, vedi lib/events/person-photo).
 *
 * Chi la vede:
 * - chiunque, finché una persona che la usa è presentata nella pagina
 *   pubblica di un evento che la mostra: l'organizzatore principale con
 *   `moderatorPublicListed`, o una concessione non revocata con
 *   `publicListed` (la regola di lib/events/public-people), su un evento la
 *   cui pagina si apre (isEventPageVisible). Tolta la persona dalla pagina,
 *   revocata, o chiusa la pagina, la foto smette di essere pubblica anche per
 *   chi ne conosce l'indirizzo (i dati strutturati lo danno ai motori di
 *   ricerca). Leggibile da un'altra origine, per le anteprime dei link, e
 *   conservata nel browser solo per pochi minuti.
 * - lo staff che gestisce un evento che la usa (il wizard e la sua
 *   anteprima), e qualunque sessione dello staff per una foto appena
 *   caricata, che nessuno usa ancora. Risposta privata e mai conservata.
 * - nessun altro: 404, e la pagina ricade sulle iniziali. Il link di
 *   conduzione non entra mai nell'indirizzo di un'immagine: chi ha solo
 *   quello vede le iniziali di chi non è nella pagina pubblica.
 */

import { cookies } from 'next/headers';

import { eventScope, getStaffSession, type StaffSession } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { isEventPageVisible } from '@/lib/events/visibility';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un'immagine e basta: niente script, niente risorse caricate da lei. */
const IMMAGINE = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
} as const;

/** La foto di una persona presentata: le stesse intestazioni della foto
 *  della sala (/api/avatar/photo), con una cache breve. Solo nel browser,
 *  nessuna cache condivisa: tolta la persona dalla pagina, la foto smette
 *  presto di vedersi anche per chi l'aveva già aperta. */
const PUBBLICA = {
  ...IMMAGINE,
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cache-Control': 'private, max-age=300',
} as const;

/** La foto vista dallo staff: solo per l'origine dell'app, mai conservata. */
const SOLO_STAFF = {
  ...IMMAGINE,
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'private, no-store',
} as const;

/** Gli stati che decidono se la pagina pubblica di un evento si apre. */
const VISIBILITA = {
  status: true,
  eventType: true,
  endsAt: true,
  postEventPublic: true,
  postEventPublicUntil: true,
} as const;

/** Niente foto, o non per chi chiede: la stessa risposta, che non dice
 *  quale dei due. Mai conservata: la risposta dipende dalla sessione. */
function nonTrovata(): Response {
  return new Response(null, {
    status: 404,
    headers: { ...IMMAGINE, 'Cache-Control': 'private, no-store' },
  });
}

/** Se la sessione gestisce un evento che usa la foto (la regola di
 *  `eventScope`), con una concessione revocata o no. */
async function gestisceUnEventoCheLaUsa(session: StaffSession, id: string): Promise<boolean> {
  if (session.role === 'admin') return true;
  const eventi = await prisma.event.count({
    where: {
      ...eventScope(session),
      OR: [{ moderatorPhotoId: id }, { additionalMods: { some: { photoId: id } } }],
    },
  });
  return eventi > 0;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return nonTrovata();
  const foto = await prisma.eventPersonPhoto.findUnique({
    where: { id },
    select: {
      bytes: true,
      contentType: true,
      // Chi la usa ed e' presentato, con lo stato del suo evento.
      leadOf: {
        where: { moderatorPublicListed: true },
        select: { moderatorName: true, ...VISIBILITA },
      },
      grants: {
        where: { publicListed: true, revokedAt: null },
        select: { event: { select: VISIBILITA } },
      },
      _count: { select: { leadOf: true, grants: true } },
    },
  });
  if (!foto) return nonTrovata();

  const immagine = (headers: Record<string, string>) =>
    new Response(new Uint8Array(foto.bytes), {
      headers: { ...headers, 'Content-Type': foto.contentType },
    });

  const pubblica =
    foto.leadOf.some((e) => !!e.moderatorName && isEventPageVisible(e)) ||
    foto.grants.some((g) => isEventPageVisible(g.event));
  if (pubblica) return immagine(PUBBLICA);

  const session = await getStaffSession(await cookies());
  if (!session) return nonTrovata();
  const usata = foto._count.leadOf + foto._count.grants > 0;
  if (usata && !(await gestisceUnEventoCheLaUsa(session, id))) return nonTrovata();
  return immagine(SOLO_STAFF);
}
