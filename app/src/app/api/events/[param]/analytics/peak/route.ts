import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { extractModeratorToken, isEventModerator } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function eventWhereClause(param: string) {
  return UUID_RE.test(param)
    ? { OR: [{ id: param }, { slug: param }] }
    : { slug: param };
}

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const event = await prisma.event.findFirst({
    where: {
      ...eventWhereClause(param),
      moderatorToken: token,
    },
    select: { peakParticipants: true, status: true },
  });

  if (!event) {
    throw new AppError('Event not found', 404, 'NOT_FOUND');
  }

  return NextResponse.json({
    peakParticipants: event.peakParticipants,
    isLive: event.status === 'LIVE',
  });
});

const peakSchema = z.object({
  count: z.number().int().min(0),
  // Either a moderator token (primary/co-moderator) OR a participant access
  // token — any authenticated attendee of THIS event may report the live count
  // so the peak isn't stuck at 0 in a moderator-less session (feedback #4b).
  token: z.string().min(1),
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const body = await request.json();
  const parsed = peakSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid payload', 400, 'INVALID_BODY');
  }

  const { count, token } = parsed.data;

  const event = await prisma.event.findFirst({
    where: {
      ...eventWhereClause(param),
      status: 'LIVE',
    },
    select: { id: true, moderatorToken: true, peakParticipants: true, maxParticipants: true },
  });

  if (!event) {
    throw new AppError('Event not found or not live', 404, 'NOT_FOUND');
  }

  // Authorize: a moderator token (primary or co-moderator) OR a registration
  // access token bound to this event. Guests (no token) never reach here — the
  // client only reports when it holds a token.
  let authorized = await isEventModerator(event, token);
  if (!authorized) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { eventId: true },
    });
    authorized = reg?.eventId === event.id;
  }
  if (!authorized) {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  // The count is client-reported, so clamp to the configured capacity to bound
  // any inflation before the monotonic bump.
  const capped = event.maxParticipants
    ? Math.min(count, event.maxParticipants)
    : count;

  if (capped > event.peakParticipants) {
    await prisma.event.update({
      where: { id: event.id },
      data: { peakParticipants: capped },
    });
  }

  return NextResponse.json({ ok: true });
});
