/**
 * Audience pulse su un punto d'agenda: il partecipante esprime assenso o
 * dissenso. Funzione opt-in (Event.agendaEnabled), pattern allineato a
 * polls/[id]/vote:
 *   POST { value: 'AGREE'|'DISAGREE'|null, accessToken?, guestId? }
 *     - value AGREE/DISAGREE → upsert (un voto per identità; cambiare valore
 *       aggiorna in place, nessun double-count)
 *     - value null           → ritira il voto (toggle off)
 * Identità: partecipante registrato (accessToken → registrationId) oppure
 * guest anonimo (guestId client-side). I moderatori guidano la discussione e
 * non votano (il client non mostra loro i pulsanti).
 */

import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  RateLimitError,
} from '@/lib/errors';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const reactionSchema = z.object({
  value: z.enum(['AGREE', 'DISAGREE']).nullable(),
  accessToken: z.string().min(1).optional(),
  guestId: z.string().min(1).max(64).optional(),
});

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug, id: itemId } = (await context.params) as {
    param: string;
    id: string;
  };

  const body = await parseJsonBody(request);
  const parsed = reactionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { value, accessToken, guestId } = parsed.data;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, agendaEnabled: true },
  });
  if (!event) throw new NotFoundError('Event');
  if (!event.agendaEnabled) throw new ForbiddenError('Agenda disabled');

  // Coarse per-IP backstop against guestId-rotation spam. Kept generous: a
  // large share of a PA audience can share one institutional egress IP, and a
  // moderator "focus" moment can burst many reactions at once — the real
  // per-voter guard is the per-identity 30/min limit below.
  const ip = getClientIp(request);
  const ipRl = rateLimit(`agenda-react-ip:${ip}:${event.id}`, {
    limit: 600,
    windowMs: 60_000,
  });
  if (!ipRl.allowed) {
    throw new RateLimitError((ipRl.resetAt - Date.now()) / 1000);
  }

  const item = await prisma.eventAgendaItem.findUnique({
    where: { id: itemId },
    select: { id: true, eventId: true },
  });
  if (!item || item.eventId !== event.id) throw new NotFoundError('Agenda item');

  // Resolve a single, non-spoofable-where-possible identity.
  let registrationId: string | null = null;
  if (accessToken) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken },
      select: { id: true, eventId: true },
    });
    if (!reg || reg.eventId !== event.id) {
      throw new ForbiddenError('Invalid access token');
    }
    registrationId = reg.id;
    const rl = rateLimit(`agenda-react:${reg.id}`, { limit: 30, windowMs: 60_000 });
    if (!rl.allowed) throw new RateLimitError();
  } else if (guestId) {
    const rl = rateLimit(`agenda-react-guest:${guestId}`, {
      limit: 30,
      windowMs: 60_000,
    });
    if (!rl.allowed) throw new RateLimitError();
  } else {
    throw new ValidationError('Identity required (accessToken or guestId)');
  }

  const identityWhere = registrationId
    ? { agendaItemId_registrationId: { agendaItemId: itemId, registrationId } }
    : { agendaItemId_guestId: { agendaItemId: itemId, guestId: guestId! } };

  if (value === null) {
    // Toggle off — idempotent (deleteMany doesn't throw when absent).
    await prisma.agendaItemReaction.deleteMany({
      where: registrationId
        ? { agendaItemId: itemId, registrationId }
        : { agendaItemId: itemId, guestId: guestId! },
    });
  } else {
    await prisma.agendaItemReaction.upsert({
      where: identityWhere,
      create: {
        agendaItemId: itemId,
        registrationId,
        guestId: guestId ?? null,
        value,
      },
      update: { value },
    });
  }

  const counts = await prisma.agendaItemReaction.groupBy({
    by: ['value'],
    where: { agendaItemId: itemId },
    _count: { _all: true },
  });
  const agreeCount = counts.find((c) => c.value === 'AGREE')?._count._all ?? 0;
  const disagreeCount =
    counts.find((c) => c.value === 'DISAGREE')?._count._all ?? 0;

  return Response.json(
    { ok: true, itemId, agreeCount, disagreeCount, myReaction: value },
    { status: 201 },
  );
});
