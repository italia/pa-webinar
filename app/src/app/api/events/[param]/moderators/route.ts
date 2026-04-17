/**
 * Co-moderator management for an event.
 *
 *   GET   — list co-moderators (primary moderator only)
 *   POST  — add a new co-moderator; returns the generated token so the
 *           UI can surface the magic link to the primary moderator.
 *
 * Authentication: the caller must hold the primary `moderatorToken`
 * for the event (verified via verifyModeratorToken — which also now
 * accepts co-moderator tokens, so we additionally require the token
 * to be the primary one for these management actions).
 */

import { randomUUID } from 'crypto';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const addModeratorSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().optional(),
});

async function requirePrimary(eventIdOrSlug: string, token: string) {
  const where = UUID_RE.test(eventIdOrSlug)
    ? { id: eventIdOrSlug }
    : { slug: eventIdOrSlug };
  const event = await prisma.event.findUnique({ where });
  if (!event) {
    throw new AppError('Event not found', 404, 'NOT_FOUND');
  }
  if (!constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Only the primary moderator can manage co-moderators');
  }
  return event;
}

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await requirePrimary(param, token);

  const rows = await prisma.eventModerator.findMany({
    where: { eventId: event.id },
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      email: true,
      token: true,
      createdAt: true,
      revokedAt: true,
    },
  });

  return Response.json({ rows });
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await requirePrimary(param, token);

  const body = await parseJsonBody(request);
  const parsed = addModeratorSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const created = await prisma.eventModerator.create({
    data: {
      eventId: event.id,
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      token: randomUUID(),
    },
  });

  return Response.json(created, { status: 201 });
});
