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

  return Response.json({ agendaEnabled: event.agendaEnabled, items });
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
