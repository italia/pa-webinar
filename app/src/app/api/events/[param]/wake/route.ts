/**
 * POST /api/events/[slug]/wake
 *
 * Called by the event page when a user tries to enter an event that's been
 * scaled to zero (status = IDLE) or is still pending (status = PROVISIONING).
 * Flips IDLE → PROVISIONING so the next scaler cycle brings the JVB up.
 *
 * The actual scaling is done by the jvb-scaler CronJob (runs every 2 min)
 * via /api/internal/jvb-desired-replicas. This endpoint just records intent.
 *
 * Idempotent: calling it on an already-PROVISIONING event is a no-op that
 * still returns 200.
 *
 * Not rate limited per EVENT on purpose: we want all users hitting an idle
 * event to get the same fast "sala in allestimento" experience without one
 * blocking the others. The underlying state change is a single UPDATE with
 * a WHERE guard so concurrent calls collapse into one transition. There IS a
 * per-IP limit, because the endpoint is unauthenticated and each accepted call
 * can start a bridge.
 *
 * Two guards bound the cost: the per-IP limit below, and the pre-scale window
 * (see canWakeNow) — a room may only be warmed when the scaler would warm it
 * anyway, not hours or days ahead.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, ConflictError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { canWakeNow, wakeWindowOpensAt } from '@/lib/events/lifecycle';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const rl = rateLimit(`wake:${getClientIp(request)}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      eventType: true,
      provisioningStartedAt: true,
    },
  });

  if (!event) throw new NotFoundError('Event');

  const now = new Date();

  // Warming the bridge costs a JVB node, and this endpoint has no
  // authentication, so the only thing standing between a passer-by with a slug
  // and a running bridge is this window. It opens exactly when the scaler would
  // pre-scale the room anyway — earlier is pure waste, and the scaler still
  // brings the bridge up on schedule without anyone asking.
  const settings = await getSettings();
  const wakeInput = {
    startsAt: event.startsAt,
    eventType: event.eventType,
    preScaleMinutes: settings.jvbPreScaleMinutes ?? 15,
    now,
  };
  if (!canWakeNow(wakeInput)) {
    const opensAt = wakeWindowOpensAt(wakeInput);
    throw new ConflictError('Too early to warm up the room', {
      currentStatus: event.status,
      opensAt: opensAt ? opensAt.toISOString() : null,
    });
  }

  if (event.endsAt < now) {
    throw new ConflictError('Event is already over', { currentStatus: event.status });
  }

  if (event.status === 'ENDED' || event.status === 'ARCHIVED' || event.status === 'DRAFT') {
    throw new ConflictError('Event is not joinable', { currentStatus: event.status });
  }

  // Already in the right state → no-op.
  if (event.status === 'LIVE' || event.status === 'PROVISIONING') {
    return Response.json({
      status: event.status,
      provisioningStartedAt: event.provisioningStartedAt,
      alreadyProvisioning: true,
    });
  }

  // IDLE or PUBLISHED → PROVISIONING. We use updateMany with a status guard
  // so two concurrent requests can't both transition the row.
  const updated = await prisma.event.updateMany({
    where: {
      id: event.id,
      status: { in: ['IDLE', 'PUBLISHED'] },
    },
    data: {
      status: 'PROVISIONING',
      provisioningStartedAt: now,
    },
  });

  // If the race lost, re-read to find out what won.
  if (updated.count === 0) {
    const fresh = await prisma.event.findUnique({
      where: { id: event.id },
      select: { status: true, provisioningStartedAt: true },
    });
    return Response.json({
      status: fresh?.status,
      provisioningStartedAt: fresh?.provisioningStartedAt,
      alreadyProvisioning: true,
    });
  }

  return Response.json({
    status: 'PROVISIONING',
    provisioningStartedAt: now.toISOString(),
    alreadyProvisioning: false,
  });
});
