// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Cross-event moderator directory.
 *
 * Lists the moderator magic link of every event so an admin can copy or
 * regenerate it without digging into individual events. The link opens the
 * publication and deletion of the event's recording, so the token is only
 * returned for the events the admin organizes (lib/recording/content-access);
 * for the others `moderatorToken` is null.
 *
 * POST with { eventId, action: 'regenerate' } rotates the token: allowed on
 * every event (it locks out a leaked link), but the new token comes back only
 * to an organizer of the event.
 */

import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';
import { EventStatus, type Prisma } from '@prisma/client';

import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth/staff-session';
import { eventiOrganizzati, organizzaEvento } from '@/lib/recording/content-access';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  const session = await requireAdmin(await cookies());

  const url = new URL(request.url);
  const search = url.searchParams.get('q')?.trim() ?? '';
  const status = url.searchParams.get('status'); // optional filter

  const where: Prisma.EventWhereInput = {
    status: { not: 'DRAFT' },
  };
  if (status) {
    const valido = z.nativeEnum(EventStatus).safeParse(status);
    if (!valido.success) throw new ValidationError('Invalid status');
    where.status = valido.data;
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

  const organizzati = await eventiOrganizzati(session, rows.map((e) => e.id));

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
        moderatorToken: organizzati.has(e.id) ? e.moderatorToken : null,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

const rotateSchema = z.object({
  eventId: z.guid(),
  action: z.literal('regenerate'),
});

export const POST = withErrorHandling(async (request) => {
  const session = await requireAdmin(await cookies());

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
    // Il link nuovo, come il vecchio, solo a chi organizza l'evento.
    moderatorToken: (await organizzaEvento(session, eventId)) ? newToken : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
});
