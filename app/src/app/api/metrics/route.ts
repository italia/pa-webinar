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
  jvbParticipantsGauge,
  jvbConferencesGauge,
  jvbStressLevelGauge,
} from '@/lib/metrics';

export const dynamic = 'force-dynamic';

async function refreshJvbGauges(): Promise<void> {
  const url = process.env.JVB_HEALTH_URL;
  if (!url) return;
  try {
    const res = await fetch(`${url}/colibri/stats`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const s = await res.json() as Record<string, unknown>;
    if (typeof s.participants === 'number') jvbParticipantsGauge.set(s.participants);
    if (typeof s.conferences === 'number') jvbConferencesGauge.set(s.conferences);
    if (typeof s.stress_level === 'number') jvbStressLevelGauge.set(s.stress_level);
  } catch { /* JVB not reachable — gauges keep last known value */ }
}

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
    refreshJvbGauges(),
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
