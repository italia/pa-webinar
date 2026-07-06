import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { updatePollStatusSchema } from '@/lib/validation/schemas';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

// ── PATCH /api/events/[slug]/polls/[id] — update status ──

export const PATCH = withErrorHandling(async (request, context) => {
  const { param: slug, id: pollId } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const body = await parseJsonBody(request);
  const parsed = updatePollStatusSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, eventId: true },
  });

  if (!poll || poll.eventId !== event.id) {
    throw new NotFoundError('Poll');
  }

  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: {
      status: parsed.data.status,
      closedAt: parsed.data.status !== 'OPEN' ? new Date() : null,
    },
  });

  return Response.json({
    id: updated.id,
    status: updated.status,
    closedAt: updated.closedAt?.toISOString() ?? null,
  });
});

// ── DELETE /api/events/[slug]/polls/[id] ──

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: slug, id: pollId } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, eventId: true },
  });

  if (!poll || poll.eventId !== event.id) {
    throw new NotFoundError('Poll');
  }

  await prisma.poll.delete({ where: { id: pollId } });

  return Response.json({ ok: true });
});
