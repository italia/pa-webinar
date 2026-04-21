/**
 * Update or delete a single co-organizer.
 *
 *   PATCH  — edit fields (name / logoUrl / websiteUrl / sortOrder)
 *   DELETE — hard-delete the row (no magic link or tokens to revoke)
 *
 * Auth: primary moderator token only.
 */

import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  logoUrl: z.string().url().nullable().optional(),
  websiteUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

async function requirePrimary(param: string, orgId: string, token: string) {
  if (!UUID_RE.test(orgId)) {
    throw new AppError('orgId must be a UUID', 400, 'BAD_REQUEST');
  }
  const where = UUID_RE.test(param) ? { id: param } : { slug: param };
  const event = await prisma.event.findUnique({ where });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
  if (!constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Only the primary moderator can manage organizers');
  }
  const org = await prisma.eventOrganizer.findUnique({ where: { id: orgId } });
  if (!org || org.eventId !== event.id) {
    throw new AppError('Organizer not found', 404, 'NOT_FOUND');
  }
  return { event, org };
}

export const PATCH = withErrorHandling(async (request, context) => {
  const { param, orgId } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  await requirePrimary(param, orgId, token);

  const body = await parseJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const updated = await prisma.eventOrganizer.update({
    where: { id: orgId },
    data: parsed.data,
  });

  return Response.json(updated);
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param, orgId } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  await requirePrimary(param, orgId, token);

  await prisma.eventOrganizer.delete({ where: { id: orgId } });

  return Response.json({ deleted: true, id: orgId });
});
