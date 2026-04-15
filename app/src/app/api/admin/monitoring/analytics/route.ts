/**
 * Admin monitoring analytics — DB-driven metrics for the technical
 * dashboard at /admin/monitoring.
 *
 * Complements the Prometheus time-series proxy at /api/admin/metrics/query
 * by aggregating stuff that only lives in the Postgres DB: events,
 * registrations and CallSession telemetry. Time-windowed (24h / 7d / 30d).
 *
 * Auth: admin session only.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

type Range = '24h' | '7d' | '30d';

function parseRange(s: string | null): { range: Range; since: Date; bucket: 'hour' | 'day' } {
  const now = Date.now();
  if (s === '24h') {
    return { range: '24h', since: new Date(now - 24 * 3600_000), bucket: 'hour' };
  }
  if (s === '30d') {
    return { range: '30d', since: new Date(now - 30 * 86400_000), bucket: 'day' };
  }
  return { range: '7d', since: new Date(now - 7 * 86400_000), bucket: 'day' };
}

interface Bucket {
  ts: string; // ISO start of bucket
  events: number;
  registrations: number;
  callSessions: number;
  peakParticipants: number;
}

interface CallRow {
  id: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  jitsiRoomName: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  peakParticipants: number;
  recordingUrl: string | null;
  recordingFileSize: string | null; // BigInt → string
  telemetry: Record<string, unknown>;
}

interface Summary {
  range: Range;
  since: string;
  now: string;
  events: {
    total: number;
    byStatus: Record<string, number>;
    avgParticipants: number | null;
    totalParticipants: number;
    mostCrowded: { title: string; peak: number; startedAt: string } | null;
  };
  registrations: {
    total: number;
    confirmed: number;
  };
  callSessions: {
    total: number;
    totalDurationSeconds: number;
    totalRecordingBytes: string; // BigInt → string
    avgDurationSeconds: number | null;
    avgPeakParticipants: number | null;
  };
  buckets: Bucket[];
  recentCalls: CallRow[];
  scaleToZero: {
    idleEvents: number;
    provisioningEvents: number;
    liveEvents: number;
  };
}

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const { range, since, bucket } = parseRange(url.searchParams.get('range'));
  const now = new Date();

  const [
    eventsInRange,
    eventsByStatus,
    registrationsInRange,
    callSessionsInRange,
    recentCallSessions,
    scaleStatusCounts,
  ] = await Promise.all([
    prisma.event.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        createdAt: true,
        status: true,
        peakParticipants: true,
        title: true,
      },
    }),
    prisma.event.groupBy({
      by: ['status'],
      _count: { id: true },
      where: { createdAt: { gte: since } },
    }),
    prisma.registration.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, joinedAt: true },
    }),
    prisma.callSession.findMany({
      where: { startedAt: { gte: since } },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        duration: true,
        peakParticipants: true,
        recordingFileSize: true,
      },
    }),
    prisma.callSession.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        eventId: true,
        jitsiRoomName: true,
        startedAt: true,
        endedAt: true,
        duration: true,
        peakParticipants: true,
        recordingUrl: true,
        recordingFileSize: true,
        telemetry: true,
        event: {
          select: { slug: true, title: true },
        },
      },
    }),
    prisma.event.groupBy({
      by: ['status'],
      _count: { id: true },
      where: {
        status: { in: ['LIVE', 'IDLE', 'PROVISIONING'] },
        endsAt: { gte: now },
      },
    }),
  ]);

  // Bucket aggregation. With small result sets (up to ~100 events/day in
  // the worst case) this is cheaper than doing it in SQL.
  const buckets: Map<string, Bucket> = new Map();
  const truncate = (d: Date): Date => {
    const c = new Date(d);
    if (bucket === 'hour') {
      c.setMinutes(0, 0, 0);
    } else {
      c.setUTCHours(0, 0, 0, 0);
    }
    return c;
  };
  const bucketStep = bucket === 'hour' ? 3600_000 : 86400_000;
  const bucketCount = bucket === 'hour' ? 24 : range === '7d' ? 7 : 30;
  // Prefill empty buckets so the chart shows zeros where nothing happened.
  {
    const start = truncate(new Date(now.getTime() - (bucketCount - 1) * bucketStep));
    for (let i = 0; i < bucketCount; i++) {
      const b = new Date(start.getTime() + i * bucketStep);
      buckets.set(b.toISOString(), {
        ts: b.toISOString(),
        events: 0,
        registrations: 0,
        callSessions: 0,
        peakParticipants: 0,
      });
    }
  }

  for (const e of eventsInRange) {
    const k = truncate(e.createdAt).toISOString();
    const b = buckets.get(k);
    if (!b) continue;
    b.events += 1;
  }
  for (const r of registrationsInRange) {
    const k = truncate(r.createdAt).toISOString();
    const b = buckets.get(k);
    if (!b) continue;
    b.registrations += 1;
  }
  for (const cs of callSessionsInRange) {
    const k = truncate(cs.startedAt).toISOString();
    const b = buckets.get(k);
    if (!b) continue;
    b.callSessions += 1;
    if (cs.peakParticipants > b.peakParticipants) {
      b.peakParticipants = cs.peakParticipants;
    }
  }

  // Most crowded event in range
  let mostCrowded: Summary['events']['mostCrowded'] = null;
  for (const e of eventsInRange) {
    if (!mostCrowded || e.peakParticipants > mostCrowded.peak) {
      mostCrowded = {
        title: getLocalized(e.title as LocalizedField, 'it'),
        peak: e.peakParticipants,
        startedAt: e.createdAt.toISOString(),
      };
    }
  }

  const totalParticipants = eventsInRange.reduce((a, e) => a + e.peakParticipants, 0);
  const totalCallDuration = callSessionsInRange.reduce((a, cs) => a + (cs.duration ?? 0), 0);
  const totalRecordingBytes = callSessionsInRange.reduce(
    (a, cs) => a + (cs.recordingFileSize ? BigInt(cs.recordingFileSize) : 0n),
    0n,
  );

  const confirmedRegs = registrationsInRange.filter((r) => r.joinedAt !== null).length;

  const byStatus: Record<string, number> = {};
  for (const row of eventsByStatus) byStatus[row.status] = row._count.id;

  const scaleCounts: Record<string, number> = { LIVE: 0, IDLE: 0, PROVISIONING: 0 };
  for (const row of scaleStatusCounts) scaleCounts[row.status] = row._count.id;

  const summary: Summary = {
    range,
    since: since.toISOString(),
    now: now.toISOString(),
    events: {
      total: eventsInRange.length,
      byStatus,
      avgParticipants: eventsInRange.length > 0
        ? Math.round((totalParticipants / eventsInRange.length) * 10) / 10
        : null,
      totalParticipants,
      mostCrowded,
    },
    registrations: {
      total: registrationsInRange.length,
      confirmed: confirmedRegs,
    },
    callSessions: {
      total: callSessionsInRange.length,
      totalDurationSeconds: totalCallDuration,
      totalRecordingBytes: totalRecordingBytes.toString(),
      avgDurationSeconds: callSessionsInRange.length > 0
        ? Math.round(totalCallDuration / callSessionsInRange.length)
        : null,
      avgPeakParticipants: callSessionsInRange.length > 0
        ? Math.round(
            (callSessionsInRange.reduce((a, cs) => a + cs.peakParticipants, 0) /
              callSessionsInRange.length) * 10,
          ) / 10
        : null,
    },
    buckets: Array.from(buckets.values()),
    recentCalls: recentCallSessions.map((cs) => ({
      id: cs.id,
      eventId: cs.eventId,
      eventTitle: getLocalized(cs.event.title as LocalizedField, 'it'),
      eventSlug: cs.event.slug,
      jitsiRoomName: cs.jitsiRoomName,
      startedAt: cs.startedAt.toISOString(),
      endedAt: cs.endedAt?.toISOString() ?? null,
      durationSeconds: cs.duration,
      peakParticipants: cs.peakParticipants,
      recordingUrl: cs.recordingUrl,
      recordingFileSize: cs.recordingFileSize?.toString() ?? null,
      telemetry: cs.telemetry as Record<string, unknown>,
    })),
    scaleToZero: {
      idleEvents: scaleCounts.IDLE ?? 0,
      provisioningEvents: scaleCounts.PROVISIONING ?? 0,
      liveEvents: scaleCounts.LIVE ?? 0,
    },
  };

  return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
});
