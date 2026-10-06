import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { recordLiveAction } from '@/lib/live/actions';
import { countWordsByPerson } from '@/lib/wordcloud/normalize';
import { forgetWordcloudLite } from '@/lib/wordcloud/lite';
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
    select: { id: true, eventId: true, status: true },
  });

  if (!round || round.eventId !== event.id) {
    throw new NotFoundError('Word cloud round');
  }

  const updated = await prisma.wordCloudRound.update({
    where: { id: roundId },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  forgetWordcloudLite(event.id);
  pokeLivePanel(event.id, 'wordcloud');

  // Cronologia: solo se il giro era ancora aperto (richiuderlo non e' un
  // fatto nuovo), con le parole piu' scritte al momento della chiusura.
  if (round.status === 'OPEN') {
    const visibili = await prisma.wordCloudSubmission.findMany({
      where: { roundId: round.id, hiddenAt: null },
      select: { word: true, registrationId: true, guestId: true },
    });
    await recordLiveAction({
      eventId: event.id,
      kind: 'wordcloud.closed',
      actor: 'moderator',
      data: {
        roundId: updated.id,
        prompt: updated.prompt,
        words: countWordsByPerson(visibili).slice(0, 15),
      },
    });
  }

  return Response.json({
    id: updated.id,
    status: updated.status,
    closedAt: updated.closedAt?.toISOString() ?? null,
  });
});
