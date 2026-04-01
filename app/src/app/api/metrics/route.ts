import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { UnauthorizedError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { constantTimeEqual } from '@/lib/auth/moderator';
import {
  register,
  activeEventsGauge,
  totalRegistrationsGauge,
  totalEventsGauge,
} from '@/lib/metrics';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  const cronKey = process.env.CRON_API_KEY;
  const authHeader = request.headers.get('authorization');
  const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!cronKey || !constantTimeEqual(providedKey, cronKey)) {
    throw new UnauthorizedError();
  }

  const [liveCount, totalRegs, statusCounts] = await Promise.all([
    prisma.event.count({ where: { status: 'LIVE' } }),
    prisma.registration.count(),
    prisma.event.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
  ]);

  activeEventsGauge.set(liveCount);
  totalRegistrationsGauge.set(totalRegs);

  totalEventsGauge.reset();
  for (const row of statusCounts) {
    totalEventsGauge.labels(row.status).set(row._count.id);
  }

  const metrics = await register.metrics();

  return new NextResponse(metrics, {
    status: 200,
    headers: {
      'Content-Type': register.contentType,
      'Cache-Control': 'no-store',
    },
  });
});
