import { type PollStatus } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/lib/errors';
import { deleteCacheByPrefix } from '@/lib/cache';
import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { recordLiveAction, type LiveActionKind } from '@/lib/live/actions';
import { updatePollStatusSchema } from '@/lib/validation/schemas';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

/** Il passaggio di stato, come lo legge la cronologia della sala. */
const KIND_PER_STATO: Record<PollStatus, LiveActionKind> = {
  OPEN: 'poll.reopened',
  CLOSED: 'poll.closed',
  PUBLISHED: 'poll.published',
};

/** Voti per opzione (per indice) e totale, aggregati come nella GET. */
async function conteggiVoti(pollId: string, options: string[]) {
  const tally = await prisma.pollVote.groupBy({
    by: ['optionIndex'],
    where: { pollId },
    _count: { _all: true },
  });
  const perIndice = new Map(tally.map((r) => [r.optionIndex, r._count._all]));
  const counts = options.map((_, idx) => perIndice.get(idx) ?? 0);
  return { counts, totalVotes: counts.reduce((a, b) => a + b, 0) };
}

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
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, eventId: true, status: true },
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

  deleteCacheByPrefix(`polls:${event.id}`);
  pokeLivePanel(event.id, 'polls');

  // Cronologia: solo un cambio di stato vero. Chiudendo o pubblicando si
  // fissano anche i risultati di quel momento.
  if (updated.status !== poll.status) {
    const kind = KIND_PER_STATO[updated.status];
    const options = updated.options as string[];
    const data =
      updated.status === 'OPEN'
        ? { pollId: updated.id, question: updated.question }
        : {
            pollId: updated.id,
            question: updated.question,
            options,
            ...(await conteggiVoti(updated.id, options)),
          };
    await recordLiveAction({ eventId: event.id, kind, actor: 'moderator', data });
  }

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
    select: { id: true, eventId: true, question: true },
  });

  if (!poll || poll.eventId !== event.id) {
    throw new NotFoundError('Poll');
  }

  await prisma.poll.delete({ where: { id: pollId } });

  deleteCacheByPrefix(`polls:${event.id}`);
  pokeLivePanel(event.id, 'polls');

  await recordLiveAction({
    eventId: event.id,
    kind: 'poll.deleted',
    actor: 'moderator',
    data: { pollId: poll.id, question: poll.question },
  });

  return Response.json({ ok: true });
});
