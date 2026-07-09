import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { eventParamWhere } from '@/lib/events/event-param';
import { verifyEventAccess, eventAccessCookieName } from '@/lib/event-session';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ accessToken: z.string().min(1).max(256) });

/**
 * POST /api/events/[param]/attendance/leave  (P1 analytics)
 *
 * Records a REGISTRANT's leave time (Registration.leftAt) so post-event
 * analytics can compute dwell / retention. Sent best-effort by the live client
 * as a beacon on intentional close (readyToClose) and on real unload (pagehide
 * with !persisted) while in-call — mirroring how joinedAt is written.
 *
 * Identity binding (F7): joinedAt is only written for the cookie-verified OWNER
 * of the personal link; leftAt must match. So we require the signed
 * `event_access` cookie to carry this same accessToken (sendBeacon sends the
 * same-origin cookie). A forwarded link opened without the cookie is a silent
 * no-op — it can NOT overwrite the real registrant's leftAt. Last-write-wins;
 * only an analytics field is ever touched.
 */
export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const ip = getClientIp(request);
  // Generous limit: a co-located audience behind one NAT egress often all leave
  // within the same minute at event end — don't drop their leave beacons.
  const rl = rateLimit(`attendance-leave:${ip}`, { limit: 240, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid leave payload');
  }
  const { accessToken } = parsed.data;

  const event = await prisma.event.findFirst({
    where: eventParamWhere(param),
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  // Ownership: the browser that registered holds the signed event_access cookie
  // carrying this token. Non-owners (forwarded link) are a no-op.
  const cookieStore = await cookies();
  const ownsToken =
    (await verifyEventAccess(
      event.id,
      cookieStore.get(eventAccessCookieName(event.id))?.value,
    )) === accessToken;
  if (!ownsToken) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const res = await prisma.registration.updateMany({
    where: { accessToken, eventId: event.id },
    data: { leftAt: new Date() },
  });

  return NextResponse.json({ ok: res.count > 0 }, { status: 200 });
});
