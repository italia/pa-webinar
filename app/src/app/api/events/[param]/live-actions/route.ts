/**
 * POST /api/events/[param]/live-actions
 *
 * Le azioni dal vivo che succedono solo nel browser e il server non vede
 * passare: oggi l'avvio e l'arresto della registrazione, comandati dalla
 * chiamata (IFrame API). Le riferisce chi modera; il server le porta alla sua
 * ora (serverTimeOf) e le scrive nella cronologia della sala.
 *
 * Lo stesso cambio arriva da ogni moderatore in sala: un'azione uguale
 * all'ultima registrata da meno di DEDUP_MS non si scrive di nuovo. Oltre,
 * si scrive: se un arresto non e' stato riferito (nessun moderatore in sala
 * quando la registrazione si e' fermata), un nuovo avvio piu' tardi non va
 * perso. Lo stato trovato entrando in sala il browser non lo riferisce.
 */

import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken, isEventModerator } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { ForbiddenError, NotFoundError, RateLimitError, UnauthorizedError } from '@/lib/errors';
import { serverTimeOf } from '@/lib/live/actions';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Entro questo tempo, lo stesso cambio riferito da un altro moderatore. */
const DEDUP_MS = 10 * 60_000;

const bodySchema = z.object({
  kind: z.enum(['recording.started', 'recording.stopped']),
  /** Ora del fatto e di invio sull'orologio del browser. */
  atEpochMs: z.number().int().positive().optional(),
  sentAt: z.number().int().positive().optional(),
});

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');
  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');
  if (!(await isEventModerator(event, token))) throw new ForbiddenError('Moderator access required');

  const rl = rateLimit(`live-actions:${event.id}:${token}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const { kind, atEpochMs, sentAt } = bodySchema.parse(await parseJsonBody(request));

  const at = serverTimeOf(atEpochMs, sentAt);
  // Controllo e scrittura in fila per evento: i moderatori in sala ricevono
  // il cambio nello stesso istante e lo riferiscono insieme; senza il
  // lucchetto ognuno vedrebbe la cronologia senza quello degli altri.
  // Rotta di poche richieste: qui la scrittura si aspetta.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`live-actions:recording:${event.id}`}))`;
    const ultima = await tx.liveAction.findFirst({
      where: { eventId: event.id, kind: { in: ['recording.started', 'recording.stopped'] } },
      orderBy: { at: 'desc' },
      select: { kind: true, at: true },
    });
    if (ultima?.kind === kind && Math.abs(at.getTime() - ultima.at.getTime()) < DEDUP_MS) return;
    await tx.liveAction.create({
      data: { eventId: event.id, kind, actor: 'moderator', data: {}, at },
    });
  });
  return new Response(null, { status: 204 });
});
