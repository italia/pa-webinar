/**
 * DELETE /api/events/[slug]/wordcloud/[id]/words?word=<parola>
 *
 * Il moderatore toglie una parola da «In una parola»: sparisce dalla nuvola e
 * dal riepilogo per tutti, e in questo giro non si puo' piu' inviare. Le righe
 * restano (marcate con `hiddenAt`), cosi' continuano a contare nel limite di
 * invii di chi le aveva scritte.
 */
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken, isEventModerator } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { recordLiveAction } from '@/lib/live/actions';
import { normalizeWord } from '@/lib/wordcloud/normalize';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  word: z.string().trim().min(1).max(30),
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: slug, id: roundId } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const parsed = querySchema.safeParse({
    word: new URL(request.url).searchParams.get('word') ?? '',
  });
  const parola = parsed.success ? normalizeWord(parsed.data.word) : '';
  if (!parsed.success || !parola) {
    throw new ValidationError('Validation failed', [{ path: ['word'], message: 'word is required' }]);
  }

  const round = await prisma.wordCloudRound.findUnique({
    where: { id: roundId },
    select: { id: true, eventId: true },
  });
  if (!round || round.eventId !== event.id) {
    throw new NotFoundError('Word cloud round');
  }

  // Il confronto e' sulla parola normalizzata, come la conta la nuvola: anche
  // le righe salvate prima della normalizzazione («chiarezza!») si tolgono.
  const visibili = await prisma.wordCloudSubmission.findMany({
    where: { roundId: round.id, hiddenAt: null },
    select: { id: true, word: true },
  });
  const ids = visibili.filter((s) => normalizeWord(s.word) === parola).map((s) => s.id);
  const tolte =
    ids.length > 0
      ? await prisma.wordCloudSubmission.updateMany({
          where: { id: { in: ids }, hiddenAt: null },
          data: { hiddenAt: new Date() },
        })
      : { count: 0 };

  if (tolte.count > 0) {
    pokeLivePanel(event.id, 'wordcloud');
    // Nella cronologia solo quante righe: la parola e' scritta dal pubblico.
    await recordLiveAction({
      eventId: event.id,
      kind: 'wordcloud.word_removed',
      actor: 'moderator',
      data: { roundId: round.id, hidden: tolte.count },
    });
  }

  return Response.json({ word: parola, hidden: tolte.count });
});
