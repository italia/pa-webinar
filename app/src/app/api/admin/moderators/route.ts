/**
 * Cross-event moderator directory.
 *
 * Surfaces the moderator magic link for every event so an admin can
 * resend / copy / regenerate it without digging into individual events.
 * The moderator token is intentionally included in the response (admin
 * session only, no-store) because it's the whole point of the page.
 *
 * POST with { eventId, action: 'regenerate' } rotates the token.
 */

import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';
import type { Prisma } from '@prisma/client';

import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const search = url.searchParams.get('q')?.trim() ?? '';
  const status = url.searchParams.get('status'); // optional filter

  const where: Prisma.EventWhereInput = {
    status: { not: 'DRAFT' },
  };
  if (status) {
    where.status = status as Prisma.EnumEventStatusFilter['equals'];
  }
  if (search) {
    // Search by moderatorEmail is dropped because the column is now
    // encrypted at rest — a `contains` match on ciphertext is useless.
    // Operators can still locate moderators by slug or moderator name.
    where.OR = [
      { slug: { contains: search, mode: 'insensitive' } },
      { moderatorName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const rows = await prisma.event.findMany({
    where,
    orderBy: { startsAt: 'desc' },
    take: 200,
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      eventType: true,
      moderatorName: true,
      moderatorEmail: true,
      moderatorToken: true,
    },
  });

  return Response.json(
    {
      rows: rows.map((e) => ({
        id: e.id,
        slug: e.slug,
        title: getLocalized(e.title as LocalizedField, 'it'),
        status: e.status,
        eventType: e.eventType,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        moderatorName: e.moderatorName,
        moderatorEmail: tryDecryptPII(e.moderatorEmail),
        moderatorToken: e.moderatorToken,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

const rotateSchema = z.object({
  eventId: z.string().uuid(),
  action: z.literal('regenerate'),
});

export const POST = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const parsed = rotateSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { eventId } = parsed.data;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, moderatorToken: true },
  });
  if (!event) throw new NotFoundError('Event');

  // Rotate: new UUID v4.
  const newToken = randomUUID();
  await prisma.event.update({
    where: { id: eventId },
    data: { moderatorToken: newToken },
  });

  await logAdminAction({
    request,
    action: 'EVENT_MODERATOR_TOKEN_ROTATE',
    target: eventId,
  });

  return Response.json({
    eventId: eventId,
    moderatorToken: newToken,
  }, { headers: { 'Cache-Control': 'no-store' } });
});
