/**
 * POST /api/admin/events/[id]/recap — «Aggiorna il riepilogo pubblico».
 *
 * Il riepilogo della pagina di un evento concluso si congela alla prima
 * visita; dopo la revisione della sala (messaggi nascosti, domande chiuse,
 * sondaggi pubblicati) lo si rifa' con i dati di adesso (lib/events/recap).
 *
 * Chi: l'amministrazione e chi organizza l'evento (sessione dello staff),
 * oppure chi lo modera, con il proprio token in `Authorization: Bearer`, come
 * la revisione della sala. 409 se l'evento non e' concluso o i suoi dati sono
 * scaduti.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken, isEventModerator } from '@/lib/auth/moderator';
import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { AppError, RateLimitError } from '@/lib/errors';
import { isUuid } from '@/lib/events/event-param';
import { ricostruisciRiepilogo } from '@/lib/events/recap';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const { id } = (await context.params) as { id: string };
  if (!isUuid(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  const token = extractModeratorToken(request);
  const event = token
    ? await prisma.event.findUnique({
        where: { id },
        select: { id: true, moderatorToken: true },
      })
    : null;
  if (!(event && token && (await isEventModerator(event, token)))) {
    await requireEventManager(await cookies(), id);
  }
  // Ricostruire legge tutta la sala: una volta ogni tanto basta.
  const rl = rateLimit(`recap-rebuild:${getClientIp(request)}:${id}`, {
    limit: 6,
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  const esito = await ricostruisciRiepilogo(id);
  if (esito === 'non-concluso')
    throw new AppError('Event is not ended', 409, 'EVENT_NOT_ENDED');
  if (esito === 'scaduto')
    throw new AppError('Event data retention has expired', 409, 'RETENTION_EXPIRED');
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
});
