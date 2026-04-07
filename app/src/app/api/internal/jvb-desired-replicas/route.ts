/**
 * Internal API for JVB auto-scaling.
 *
 * Returns the desired number of JVB replicas as JSON.
 * Called by the jvb-scaler CronJob every 2 minutes (cluster-internal only).
 *
 * Scale formula:
 *   0 events → 0 replicas (scale to zero, save costs)
 *   1-2 events → 1 replica (single JVB handles ~200 users)
 *   3+ events → 1 replica per 2 events, capped at JVB_MAX_REPLICAS
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PRE_SCALE_MINUTES = parseInt(process.env.JVB_PRE_SCALE_MINUTES || '30', 10);
const MAX_REPLICAS = parseInt(process.env.JVB_MAX_REPLICAS || '4', 10);

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);
  const now = new Date();
  const preScaleWindow = new Date(now.getTime() + PRE_SCALE_MINUTES * 60 * 1000);

  const activeOrUpcoming = await prisma.event.count({
    where: {
      OR: [
        { status: 'LIVE' },
        {
          status: 'PUBLISHED',
          startsAt: { lte: preScaleWindow },
          endsAt: { gte: now },
        },
      ],
    },
  });

  let desired = 0;
  if (activeOrUpcoming > 0) {
    desired = Math.min(
      Math.max(1, Math.ceil(activeOrUpcoming / 2)),
      MAX_REPLICAS,
    );
  }

  return Response.json({
    desired,
    activeEvents: activeOrUpcoming,
    preScaleMinutes: PRE_SCALE_MINUTES,
    maxReplicas: MAX_REPLICAS,
    checkedAt: now.toISOString(),
  });
});
