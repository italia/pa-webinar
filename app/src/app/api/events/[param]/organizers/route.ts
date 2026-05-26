/**
 * Co-organizer list for an event.
 *
 *   GET  — list organizers (public; shown on the event page)
 *   POST — add an organizer (primary moderator only)
 *
 * Organizers are display metadata — no access grants — so reading them
 * doesn't need a token. Writing does: only the primary moderator token
 * can add/edit/remove entries.
 */

import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, RateLimitError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const addOrganizerSchema = z.object({
  name: z.string().min(1).max(200),
  logoUrl: z.string().url().optional().nullable(),
  websiteUrl: z.string().url().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});

async function loadEvent(param: string) {
  const where = UUID_RE.test(param) ? { id: param } : { slug: param };
  const event = await prisma.event.findUnique({ where });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
  return event;
}

export const GET = withErrorHandling(async (_request, context) => {
  const { param } = await context.params;
  const event = await loadEvent(param);

  const rows = await prisma.eventOrganizer.findMany({
    where: { eventId: event.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  return Response.json({ rows });
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await loadEvent(param);
  if (!constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Only the primary moderator can add organizers');
  }

  const ip = getClientIp(request);
  const rl = rateLimit(`organizers-add:${ip}:${event.id}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = addOrganizerSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const maxOrder = await prisma.eventOrganizer.aggregate({
    where: { eventId: event.id },
    _max: { sortOrder: true },
  });

  const created = await prisma.eventOrganizer.create({
    data: {
      eventId: event.id,
      name: parsed.data.name,
      logoUrl: parsed.data.logoUrl ?? null,
      websiteUrl: parsed.data.websiteUrl ?? null,
      sortOrder: parsed.data.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
    },
  });

  return Response.json(created, { status: 201 });
});
