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
  // co-moderator/speaker grant token, or a participant access token. Rooms where
  // no token can exist are the tokenless case — see the authorization block.
  // Bounded so a caller cannot use it as an unbounded rate-limiter key.
  token: z.string().min(1).max(512).optional(),
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const body = await request.json();
  const parsed = peakSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid payload', 400, 'INVALID_BODY');
  }

  const { count, token } = parsed.data;

  // Two throttles, deliberately in this order.
  //
  // 1) Pre-auth, keyed on the CLIENT IP — never on the request body. Keying on
  //    an unauthenticated token would be self-defeating twice over: a caller
  //    rotating tokens gets a fresh bucket every request (no limit at all), and
  //    each unique value pins another entry in the in-memory store. The IP is
  //    the only identity we have before the lookups, and this bound is what
  //    protects those lookups. Generous, because a whole organisation can share
  //    one egress IP and each client legitimately posts twice a minute.
  const ip = getClientIp(request);
  // 600/min: a 300-person room where everyone shares one corporate egress IP
  // legitimately produces ~600 reports a minute, and the pre-auth bucket must
  // never throttle a real audience (the moderator included) before the
  // per-reporter limit below has had a chance to do the accurate job.
  const ipLimit = rateLimit(`peak:ip:${ip}`, { limit: 600, windowMs: 60_000 });
  if (!ipLimit.allowed) {
    throw new RateLimitError((ipLimit.resetAt - Date.now()) / 1000);
  }

  const event = await prisma.event.findFirst({
    where: {
      ...eventWhereClause(param),
      status: 'LIVE',
    },
    select: {
      id: true,
      moderatorToken: true,
      maxParticipants: true,
      eventType: true,
      _count: { select: { registrations: true } },
    },
  });

  if (!event) {
    throw new AppError('Event not found or not live', 404, 'NOT_FOUND');
  }

  // Authorize: ANY valid grant for this event (primary/co-moderator/SPEAKER) OR
  // a registration access token bound to it. resolveGrantForEvent reuses the
  // already-fetched event (no extra query) and covers the speaker case that a
  // moderator-only check rejected.
  //
  // Tokenless reporting is accepted only where NOBODY could hold a token: an
  // INSTANT room, or an event with zero registrations. The reported figure is
  // the whole-room headcount, so a single token-bearing attendee is enough to
  // track the peak for everyone; the anonymous path is needed only when there
  // is no such attendee — which is exactly the moderator-less public-link case
  // #4b was about. Keeping it that narrow matters because the figure is
  // monotonic and publicly rendered: on an event that has registrations, a
  // public slug would otherwise let any anonymous caller pin it to the clamp.
  // `reporter` is the identity the per-event throttle is keyed on — resolved,
  // never caller-supplied.
  const tokenlessAllowed =
    event.eventType === 'INSTANT' || event._count.registrations === 0;
  let reporter: string;
  if (token) {
    const grant = await resolveGrantForEvent(event, token);
    if (grant) {
      reporter = `grant:${grant.grantId ?? 'primary'}`;
    } else {
      const reg = await prisma.registration.findUnique({
        where: { accessToken: token },
        select: { id: true, eventId: true },
      });
      if (!reg || reg.eventId !== event.id) {
        throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      }
      reporter = `reg:${reg.id}`;
    }
  } else {
    if (!tokenlessAllowed) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }
    reporter = `ip:${ip}`;
  }

  // 2) Post-auth, keyed on the resolved reporter (house style: `auth.senderId`,
  //    `registration.id`, …). One client reports twice a minute; the headroom
  //    covers remounts and reconnects.
  const rl = rateLimit(`peak:${event.id}:${reporter}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
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

  // The OPEN session gets the same treatment. It was left at 0 for every event
  // ever recorded — `Event.peakParticipants` was correct while
  // `CallSession.peakParticipants` stayed zero — so any per-session analytics
  // (a room that emptied and refilled produces several sessions) had nothing to
  // work with. Same monotonic conditional update, scoped to the session still
  // running; if none is open the update simply matches nothing.
  await prisma.callSession.updateMany({
    where: { eventId: event.id, endedAt: null, peakParticipants: { lt: capped } },
    data: { peakParticipants: capped },
  });

  return NextResponse.json({ ok: true });
});
