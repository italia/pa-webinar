/**
 * PATCH/DELETE su un singolo item d'agenda (solo moderatore).
 *   PATCH { completed?, label? } → spunta/rinomina un punto (live).
 *   DELETE → rimuove il punto.
 */

import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { NotFoundError, UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { extractModeratorToken, verifyModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  completed: z.boolean().optional(),
  label: z.string().min(1).max(500).optional(),
});

async function authItem(request: Request, slug: string, id: string) {
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');
  const event = await verifyModeratorToken(slug, token);
  if (!event) throw new ForbiddenError('Moderator access required');
  const item = await prisma.eventAgendaItem.findUnique({ where: { id } });
  if (!item || item.eventId !== event.id) throw new NotFoundError('Agenda item');
  return { item, eventId: event.id };
}

export const PATCH = withErrorHandling(async (request, context) => {
  const { param: slug, id } = (await context.params) as { param: string; id: string };
  const { eventId } = await authItem(request, slug, id);
  const body = patchSchema.parse(await request.json());

  const updated = await prisma.eventAgendaItem.update({
    where: { id },
    data: {
      ...(body.label !== undefined && { label: body.label.trim() }),
      ...(body.completed !== undefined && {
        completed: body.completed,
        completedAt: body.completed ? new Date() : null,
      }),
    },
    select: { id: true, label: true, completed: true, sortOrder: true },
  });
  pokeLivePanel(eventId, 'agenda');

  return Response.json(updated);
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: slug, id } = (await context.params) as { param: string; id: string };
  const { eventId } = await authItem(request, slug, id);
  await prisma.eventAgendaItem.delete({ where: { id } });
  pokeLivePanel(eventId, 'agenda');

  return new Response(null, { status: 204 });
});
