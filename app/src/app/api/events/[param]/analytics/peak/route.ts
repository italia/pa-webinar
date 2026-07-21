import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, RateLimitError } from '@/lib/errors';
import { extractModeratorToken, resolveGrantForEvent } from '@/lib/auth/moderator';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

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
  // Any attendee of THIS event may report the live count so the peak isn't
  // stuck at 0 in a moderator-less session (feedback #4b): a moderator/
  // co-moderator/speaker grant token, a participant access token — or, on a
  // LIVE event, a guest with no token at all (public-link and INSTANT rooms
  // have no registrations, so requiring a token left exactly those sessions
  // reporting nothing).
  token: z.string().min(1).optional(),
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const body = await request.json();
  const parsed = peakSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid payload', 400, 'INVALID_BODY');
  }

  const { count, token } = parsed.data;

  // Every reporting client posts twice a minute (immediate + 30s interval), and
  // since #4b that is N clients instead of one moderator. Without a limit this
  // was the only public write endpoint with no throttle: a 300-person room means
  // ~600 lookups+updates/min, and a single valid token (or none at all, on the
  // guest branch) could hammer it. Bucket per event+identity, with enough
  // headroom for remounts/reconnects.
  const ip = getClientIp(request);
  const rl = rateLimit(`peak:${param}:${token ?? ip}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

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
  // moderator-only check rejected.
  //
  // No token → guest. Allowed, because the event query above already pins
  // status=LIVE: a guest may only report while the room is open, exactly the
  // window in which they may also join and chat. A token that is PRESENT but
  // matches nothing is still rejected — a bad token is an error, not a silent
  // downgrade to the guest path. Worst case a guest inflates the peak up to the
  // clamp below (capacity + headroom); it is an analytics figure, rate-limited,
  // and bounded — versus the certainty of recording 0 for every public-link room.
  if (token) {
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
