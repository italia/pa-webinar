import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── DELETE /api/events/[slug]/materials/[id] ─────────────

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: slug, id } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const material = await prisma.eventMaterial.findUnique({ where: { id } });
  if (!material || material.eventId !== event.id) {
    throw new NotFoundError('Material');
  }

  await prisma.eventMaterial.delete({ where: { id } });

  return Response.json({ ok: true });
});
