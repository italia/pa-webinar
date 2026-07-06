import { withErrorHandling } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

// PATCH /api/events/[slug]/wordcloud/[id] — close round (moderator)
export const PATCH = withErrorHandling(async (request, context) => {
  const { param: slug, id: roundId } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const round = await prisma.wordCloudRound.findUnique({
    where: { id: roundId },
    select: { id: true, eventId: true },
  });

  if (!round || round.eventId !== event.id) {
    throw new NotFoundError('Word cloud round');
  }

  const updated = await prisma.wordCloudRound.update({
    where: { id: roundId },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  return Response.json({
    id: updated.id,
    status: updated.status,
    closedAt: updated.closedAt?.toISOString() ?? null,
  });
});
