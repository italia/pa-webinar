/**
 * Agenda/note live (checklist punti da trattare). Funzione opt-in
 * (Event.agendaEnabled). Pattern allineato a Q&A/poll:
 *   GET  → lista item ordinati (chiunque sia in stanza; read-only lato
 *          partecipante, il client mostra le spunte come checklist).
 *   POST → il moderatore aggiunge un punto (anche dal vivo).
 * Mutazioni protette da token moderatore (Bearer o ?token).
 */

import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { extractModeratorToken, verifyModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  label: z.string().min(1).max(500),
});

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, agendaEnabled: true },
  });
  if (!event) throw new NotFoundError('Event');

  const items = await prisma.eventAgendaItem.findMany({
    where: { eventId: event.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, label: true, completed: true, sortOrder: true },
  });

  // Audience-pulse tallies per item (assenso/dissenso). Aggregated in one
  // groupBy instead of N+1 counts.
  const counts = await prisma.agendaItemReaction.groupBy({
    by: ['agendaItemId', 'value'],
    where: { agendaItem: { eventId: event.id } },
    _count: { _all: true },
  });
  const tally = new Map<string, { agree: number; disagree: number }>();
  for (const c of counts) {
    const t = tally.get(c.agendaItemId) ?? { agree: 0, disagree: 0 };
    if (c.value === 'AGREE') t.agree = c._count._all;
    else t.disagree = c._count._all;
    tally.set(c.agendaItemId, t);
  }

  // The caller's own reaction per item, so the UI can highlight the chosen
  // button after a refresh. Identity comes from the participant accessToken
  // (Authorization: Bearer) or the anonymous guestId (?guestId= query).
  const url = new URL(request.url);
  const guestId = url.searchParams.get('guestId');
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
  let registrationId: string | null = null;
  if (bearer) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken: bearer },
      select: { id: true, eventId: true },
    });
    if (reg && reg.eventId === event.id) registrationId = reg.id;
  }
  const mine = new Map<string, 'AGREE' | 'DISAGREE'>();
  if (registrationId || guestId) {
    const myRx = await prisma.agendaItemReaction.findMany({
      where: {
        agendaItem: { eventId: event.id },
        ...(registrationId ? { registrationId } : { guestId }),
      },
      select: { agendaItemId: true, value: true },
    });
    for (const r of myRx) mine.set(r.agendaItemId, r.value);
  }

  const itemsWithReactions = items.map((i) => ({
    ...i,
    agreeCount: tally.get(i.id)?.agree ?? 0,
    disagreeCount: tally.get(i.id)?.disagree ?? 0,
    myReaction: mine.get(i.id) ?? null,
  }));

  return Response.json({ agendaEnabled: event.agendaEnabled, items: itemsWithReactions });
});

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');
  const event = await verifyModeratorToken(slug, token);
  if (!event) throw new ForbiddenError('Moderator access required');

  const { label } = createSchema.parse(await request.json());

  const max = await prisma.eventAgendaItem.aggregate({
    where: { eventId: event.id },
    _max: { sortOrder: true },
  });
  const item = await prisma.eventAgendaItem.create({
    data: {
      eventId: event.id,
      label: label.trim(),
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
    select: { id: true, label: true, completed: true, sortOrder: true },
  });

  return Response.json(item, { status: 201 });
});
