/**
 * Internal API for JVB auto-scaling.
 *
 * Returns the desired number of JVB replicas as plain text.
 * Called by the jvb-scaler CronJob every 5 minutes (cluster-internal only).
 *
 * Logic:
 *   0 events live or starting within 30 min → 0 replicas
 *   1+ events → 1 replica per event, capped at JVB_MAX_REPLICAS (default 4)
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';

const JVB_MAX_REPLICAS = parseInt(process.env.JVB_MAX_REPLICAS || '4', 10);

export const GET = withErrorHandling(async () => {
  const now = new Date();
  const thirtyMinFromNow = new Date(now.getTime() + 30 * 60 * 1000);

  const activeOrUpcoming = await prisma.event.count({
    where: {
      OR: [
        { status: 'LIVE' },
        {
          status: 'PUBLISHED',
          startsAt: { lte: thirtyMinFromNow },
          endsAt: { gte: now },
        },
      ],
    },
  });

  const desired = Math.min(activeOrUpcoming, JVB_MAX_REPLICAS);

  return new Response(String(desired), {
    headers: { 'Content-Type': 'text/plain' },
  });
});
