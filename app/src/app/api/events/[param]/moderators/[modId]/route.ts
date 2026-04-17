/**
 * Revoke (soft-delete) or hard-delete a co-moderator entry.
 *
 *   DELETE — sets `revokedAt` so the token stops being accepted. We
 *            don't hard-delete the row so the event management page
 *            can keep showing who previously had access. A real
 *            deletion happens via the cron cleanup once the retention
 *            window elapses.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = withErrorHandling(async (request, context) => {
  const { param, modId } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  if (!UUID_RE.test(modId)) {
    throw new AppError('modId must be a UUID', 400, 'BAD_REQUEST');
  }

  const where = UUID_RE.test(param)
    ? { id: param }
    : { slug: param };
  const event = await prisma.event.findUnique({ where });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
  if (!constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Only the primary moderator can revoke co-moderators');
  }

  const mod = await prisma.eventModerator.findUnique({ where: { id: modId } });
  if (!mod || mod.eventId !== event.id) {
    throw new AppError('Co-moderator not found', 404, 'NOT_FOUND');
  }

  const updated = await prisma.eventModerator.update({
    where: { id: modId },
    data: { revokedAt: mod.revokedAt ?? new Date() },
  });

  return Response.json({ revoked: true, id: updated.id });
});
