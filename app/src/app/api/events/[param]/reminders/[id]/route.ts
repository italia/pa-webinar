import { withErrorHandling } from '@/lib/api-handler';
import { AppError, NotFoundError, UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── DELETE /api/events/[slug]/reminders/[id] ─────────────

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: slug, id } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Unauthorized');
  }

  const reminder = await prisma.eventReminder.findUnique({
    where: { id },
    include: { _count: { select: { sentRecords: true } } },
  });
  if (!reminder || reminder.eventId !== event.id) {
    throw new NotFoundError('Reminder');
  }
  // Un promemoria gia' partito resta: le sue consegne (ReminderSent, che la
  // cancellazione si porterebbe via) sono la traccia di cosa e' stato mandato.
  if (reminder._count.sentRecords > 0) {
    throw new AppError('The reminder has already been sent', 409, 'REMINDER_SENT');
  }

  await prisma.eventReminder.delete({ where: { id } });

  return Response.json({ ok: true });
});
