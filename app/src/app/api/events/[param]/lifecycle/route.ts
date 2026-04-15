/**
 * GET /api/events/[slug]/lifecycle
 *
 * Lightweight, no-auth endpoint polled by the ProvisioningScreen while it
 * waits for the JVB to come up. Returns only what the UI needs to decide
 * whether to keep waiting or redirect into the Jitsi room.
 *
 * Not rate limited: the poll runs at ~5s from a single open tab, and the
 * response is cheap.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      provisioningStartedAt: true,
      lastActiveAt: true,
    },
  });

  if (!event) throw new NotFoundError('Event');

  return Response.json(
    {
      status: event.status,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      provisioningStartedAt: event.provisioningStartedAt?.toISOString() ?? null,
      lastActiveAt: event.lastActiveAt?.toISOString() ?? null,
      serverTime: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
