import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { extractModeratorToken, resolveGrantForEvent } from '@/lib/auth/moderator';

// Headroom added to the registration capacity for the client-reported peak
// clamp: moderators/co-moderators/speakers/a few guests legitimately join
// beyond maxParticipants, so a flat maxParticipants clamp under-counts, while an
// unbounded value lets an attendee inflate the monotonic peak arbitrarily.
// capacity + headroom bounds spoofing tightly while covering the extra roles.
const PEAK_CAPACITY_HEADROOM = 50;
const PEAK_FALLBACK_CAP = 500; // when maxParticipants is unset/0

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
  // Any authenticated attendee of THIS event may report the live count so the
  // peak isn't stuck at 0 in a moderator-less session (feedback #4b): a
  // moderator/co-moderator/speaker grant token OR a participant access token.
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
    select: { id: true, moderatorToken: true, maxParticipants: true },
  });

  if (!event) {
    throw new AppError('Event not found or not live', 404, 'NOT_FOUND');
  }

  // Authorize: ANY valid grant for this event (primary/co-moderator/SPEAKER) OR
  // a registration access token bound to it. resolveGrantForEvent reuses the
  // already-fetched event (no extra query) and covers the speaker case that a
  // moderator-only check rejected. Guests (no token) never reach here.
  let authorized = (await resolveGrantForEvent(event, token)) !== null;
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

  // Clamp the client-reported count to capacity + headroom (bounds a spoofed
  // value without under-counting mods/speakers/guests), then bump atomically:
  // a single conditional UPDATE ... WHERE peakParticipants < capped avoids the
  // read-then-write lost-update race under a concurrent join ramp.
  const cap = event.maxParticipants
    ? event.maxParticipants + PEAK_CAPACITY_HEADROOM
    : PEAK_FALLBACK_CAP;
  const capped = Math.min(count, cap);

  await prisma.event.updateMany({
    where: { id: event.id, peakParticipants: { lt: capped } },
    data: { peakParticipants: capped },
  });

  return NextResponse.json({ ok: true });
});
