import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, UnauthorizedError, ForbiddenError } from '@/lib/errors';
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

  const reminder = await prisma.eventReminder.findUnique({ where: { id } });
  if (!reminder || reminder.eventId !== event.id) {
    throw new NotFoundError('Reminder');
  }

  await prisma.eventReminder.delete({ where: { id } });

  return Response.json({ ok: true });
});
