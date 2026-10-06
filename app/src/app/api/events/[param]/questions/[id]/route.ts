import type { Prisma, QuestionStatus } from '@prisma/client';

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
import { recordLiveAction } from '@/lib/live/actions';
import { updateQuestionSchema } from '@/lib/validation/schemas';
import { isEventModerator } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

// ── PATCH /api/events/[slug]/questions/[id] — moderator only ─
// Stato della domanda e risposta scritta (lib/validation/schemas).

export const PATCH = withErrorHandling(async (request, context) => {
  const { param: slug, id } = await context.params;
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : url.searchParams.get('token');

  if (!token) throw new UnauthorizedError('Token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  if (!(await isEventModerator(event, token))) {
    throw new ForbiddenError('Moderator access required');
  }

  const body = await parseJsonBody(request);
  const parsed = updateQuestionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  const question = await prisma.question.findUnique({
    where: { id },
    select: { id: true, eventId: true, status: true, answerText: true },
  });
  if (!question || question.eventId !== event.id) {
    throw new NotFoundError('Question');
  }

  const data: Prisma.QuestionUpdateInput = {};
  const { answer } = parsed.data;
  const answerText = answer === undefined ? undefined : answer || null;
  if (answerText !== undefined) data.answerText = answerText;
  // La prima risposta scritta, senza stato nella richiesta, rende la domanda
  // «Risposta data». Correggere una risposta che c'e' gia' non sposta la
  // domanda, e una domanda scartata resta scartata.
  const primaRisposta =
    !!answerText &&
    !question.answerText &&
    (question.status === 'PENDING' || question.status === 'HIGHLIGHTED');
  const newStatus: QuestionStatus | undefined =
    parsed.data.status ?? (primaRisposta ? 'ANSWERED' : undefined);
  // Le date si toccano solo quando la richiesta porta uno stato (o la risposta
  // ne ricava uno): una correzione del testo le lascia com'erano.
  if (newStatus !== undefined) {
    data.status = newStatus;
    data.highlightedAt = newStatus === 'HIGHLIGHTED' ? new Date() : null;
    data.answeredAt = newStatus === 'ANSWERED' ? new Date() : null;
  }

  const updated = await prisma.question.update({
    where: { id },
    data,
  });

  deleteCacheByPrefix(`qa:${event.id}:`);
  pokeLivePanel(event.id, 'qa');

  // Cronologia: uno stato toccato o una risposta scritta. Mai i testi: la
  // domanda e' del pubblico, e la cronologia la rilegge dalla sua tabella.
  if (newStatus !== undefined || !!answerText) {
    await recordLiveAction({
      eventId: event.id,
      kind: 'question.status',
      actor: 'moderator',
      data: { questionId: updated.id, status: updated.status, answered: !!answerText },
    });
  }

  return Response.json({
    id: updated.id,
    authorName: updated.authorName,
    text: updated.text,
    answerText: updated.answerText,
    status: updated.status,
    upvoteCount: updated.upvoteCount,
    createdAt: updated.createdAt.toISOString(),
    highlightedAt: updated.highlightedAt?.toISOString() ?? null,
    answeredAt: updated.answeredAt?.toISOString() ?? null,
  });
});
