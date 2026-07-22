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

  // Keyed on IP **and event**: an IP-wide bucket meant a burst of clicks on one
  // event could starve a DIFFERENT event whose room had gone idle — and since
  // /wake is the only way back from IDLE, that room would simply never return.
  const rl = rateLimit(`wake:${getClientIp(request)}:${slug}`, {
    limit: 60,
    windowMs: 60_000,
  });
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

  // Warming the bridge costs a JVB node, and this endpoint has no
  // authentication, so this window is the only thing between a passer-by with a
  // slug and a running bridge. It opens exactly when the scaler would pre-scale
  // the room anyway — earlier is pure waste, and the scaler brings the bridge up
  // on schedule without anyone asking.
  //
  // Scope: PUBLISHED only. An IDLE room already HAD a bridge and is being
  // revived by someone who is actually there — and `/wake` is the ONLY
  // IDLE→PROVISIONING path there is (the scaler's pre-scale matches PUBLISHED),
  // so gating it would leave a room that emptied during a break dark for good.
  // The abuse this guard exists for is warming a room that has not started yet.
  //
  // Placed AFTER the LIVE/PROVISIONING no-op above so the documented
  // idempotency still holds: a room that is already warm answers 200, not 409.
  if (event.status === 'PUBLISHED') {
    const settings = await getSettings();
    const wakeInput = {
      startsAt: event.startsAt,
      eventType: event.eventType,
      // The larger of the two lead times. Coupling this to `jvbPreScaleMinutes`
      // alone would mean that lowering it (to 0, say, to save bridge minutes)
      // silently removes an early arrival's ability to warm the room at all —
      // two unrelated knobs, one surprising interaction.
      preScaleMinutes: Math.max(
        settings.jvbPreScaleMinutes ?? 15,
        settings.waitingRoomLeadMinutes ?? 15,
      ),
      now,
    };
    if (!canWakeNow(wakeInput)) {
      const opensAt = wakeWindowOpensAt(wakeInput);
      // The details payload is diagnostics only: `errorResponse` ships `details`
      // to the client for VALIDATION_ERROR or in development, never for a 409 in
      // production. The caller does not need it — it re-asks on every poll and
      // the room warms up by itself the moment the window opens.
      throw new ConflictError('Too early to warm up the room', {
        currentStatus: event.status,
        opensAt: opensAt ? opensAt.toISOString() : null,
      });
    }
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
