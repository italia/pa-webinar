import type { QuestionStatus } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { updateQuestionStatusSchema } from '@/lib/validation/schemas';
import { isEventModerator } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

// ── PATCH /api/events/[slug]/questions/[id] — moderator only ─

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
  const parsed = updateQuestionStatusSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const question = await prisma.question.findUnique({
    where: { id },
    select: { id: true, eventId: true },
  });
  if (!question || question.eventId !== event.id) {
    throw new NotFoundError('Question');
  }

  const newStatus = parsed.data.status as QuestionStatus;
  const data: Record<string, unknown> = {
    status: newStatus,
    highlightedAt: newStatus === 'HIGHLIGHTED' ? new Date() : null,
    answeredAt: newStatus === 'ANSWERED' ? new Date() : null,
  };

  const updated = await prisma.question.update({
    where: { id },
    data,
  });

  return Response.json({
    id: updated.id,
    authorName: updated.authorName,
    text: updated.text,
    status: updated.status,
    upvoteCount: updated.upvoteCount,
    createdAt: updated.createdAt.toISOString(),
    highlightedAt: updated.highlightedAt?.toISOString() ?? null,
    answeredAt: updated.answeredAt?.toISOString() ?? null,
  });
});
