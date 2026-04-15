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
 * Not rate limited per-event on purpose: we want all users hitting an idle
 * event to get the same fast "sala in allestimento" experience without one
 * blocking the others. The underlying state change is a single UPDATE with
 * a WHERE guard so concurrent calls collapse into one transition.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, ConflictError } from '@/lib/errors';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (_request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
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
