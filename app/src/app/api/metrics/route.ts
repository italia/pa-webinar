import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { UnauthorizedError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { constantTimeEqual } from '@/lib/auth/moderator';
import { readJvbSnapshot } from '@/lib/jvb-snapshot';
import {
  register,
  activeEventsGauge,
  totalRegistrationsGauge,
  totalEventsGauge,
  jvbParticipantsGauge,
  jvbConferencesGauge,
  jvbStressLevelGauge,
  jvbOctoConferencesGauge,
  jvbOctoEndpointsGauge,
  jvbOctoSendBitrateGauge,
  jvbOctoReceiveBitrateGauge,
} from '@/lib/metrics';

export const dynamic = 'force-dynamic';

/**
 * Populate the JVB gauges from the authoritative cross-pod snapshot
 * written to Redis by the scaler CronJob (`jvb:replicas:snapshot`, TTL
 * 300 s). With N>1 pods a direct Service-VIP fetch of `/colibri/stats`
 * only sees one pod's slice and reports zeros for the rest — Prometheus
 * was scraping misleading values during the Friday caffettino (apparent
 * 0 participants while the scaler correctly saw 63). Prefer the snapshot;
 * fall back to a single probe only when the snapshot is missing or has
 * no aggregated traffic data (fresh pod, scaler crashed, Redis cold).
 */
async function refreshJvbGauges(): Promise<void> {
  const snapshot = await readJvbSnapshot();
  const snapshotHasTraffic =
    snapshot?.pollSuccesses !== undefined && snapshot.pollSuccesses > 0;

  if (snapshotHasTraffic) {
    if (snapshot!.participants !== undefined) jvbParticipantsGauge.set(snapshot!.participants);
    if (snapshot!.conferences !== undefined) jvbConferencesGauge.set(snapshot!.conferences);
    if (snapshot!.stressLevel !== undefined) jvbStressLevelGauge.set(snapshot!.stressLevel);
    if (snapshot!.octoConferences !== undefined) jvbOctoConferencesGauge.set(snapshot!.octoConferences);
    if (snapshot!.octoEndpoints !== undefined) jvbOctoEndpointsGauge.set(snapshot!.octoEndpoints);
    if (snapshot!.octoSendBitrateBps !== undefined) jvbOctoSendBitrateGauge.set(snapshot!.octoSendBitrateBps);
    if (snapshot!.octoReceiveBitrateBps !== undefined) jvbOctoReceiveBitrateGauge.set(snapshot!.octoReceiveBitrateBps);
    return;
  }

  // Fallback: single-pod probe. Correct when replicas==1, a lower bound
  // otherwise. Still worth emitting so the dashboard isn't completely
  // blank when the scaler hasn't run (first deploy, Redis wipe, etc.).
  const url = process.env.JVB_HEALTH_URL;
  if (!url) return;
  try {
    const res = await fetch(`${url}/colibri/stats`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const s = await res.json() as Record<string, unknown>;
    if (typeof s.participants === 'number') jvbParticipantsGauge.set(s.participants);
    if (typeof s.conferences === 'number') jvbConferencesGauge.set(s.conferences);
    if (typeof s.stress_level === 'number') jvbStressLevelGauge.set(s.stress_level);
    if (typeof s.octo_conferences === 'number') jvbOctoConferencesGauge.set(s.octo_conferences);
    if (typeof s.octo_endpoints === 'number') jvbOctoEndpointsGauge.set(s.octo_endpoints);
    if (typeof s.octo_send_bitrate === 'number') jvbOctoSendBitrateGauge.set(s.octo_send_bitrate);
    if (typeof s.octo_receive_bitrate === 'number') jvbOctoReceiveBitrateGauge.set(s.octo_receive_bitrate);
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
