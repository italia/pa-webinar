/**
 * GET /api/admin/events/[id]/closing — «Chiudi l'evento»: lo stato di ogni
 * voce del dopo-evento (registrazione, trascrizione, resoconto, sala,
 * materiali, valutazioni, pagina pubblica), calcolato da lib/events/closing.
 *
 * Chi: l'amministrazione e chi organizza l'evento (sessione dello staff),
 * oppure chi lo modera, con il proprio token in `Authorization: Bearer`, come
 * il resto della scheda «Dopo l'evento». Sono solo stati e conteggi.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken, isEventModeratorCached } from '@/lib/auth/moderator';
import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { caricaDatiChiusura, statoChiusura } from '@/lib/events/closing';
import { isUuid } from '@/lib/events/event-param';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request, context) => {
  const { id } = (await context.params) as { id: string };
  if (!isUuid(id)) {
    throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  }
  // Prima il token, se c'e': chi apre la pagina dal link del moderatore puo'
  // avere anche una sessione dello staff che quell'evento non lo gestisce.
  const token = extractModeratorToken(request);
  const event = token
    ? await prisma.event.findUnique({
        where: { id },
        select: { id: true, moderatorToken: true },
      })
    : null;
  // La scheda la rilegge di continuo: il controllo del token passa dalla
  // cache, come per le altre rotte interrogate a intervalli.
  const daModeratore = !!(event && token && (await isEventModeratorCached(event, token)));
  if (!daModeratore) {
    await requireEventManager(await cookies(), id);
  }
  const dati = await caricaDatiChiusura(id);
  if (!dati) throw new NotFoundError('Event not found');
  // Con il solo link del moderatore cio' che si fa dall'area riservata non e'
  // «da fare» per chi guarda.
  return Response.json(statoChiusura(dati, { staff: !daModeratore }), {
    headers: { 'Cache-Control': 'no-store' },
  });
});
