/**
 * Admin cross-event video recordings library.
 *
 * Sources both Event.recordingUrl (the moderator-published recording for
 * a scheduled event) and CallSession.recordingUrl (per-session artifacts
 * produced by Jibri during a call, including instant-call sessions).
 *
 * Filters:
 *   since? / until?  — ISO timestamps, default = last 90 days
 *   eventId?         — limit to a single event's artifacts
 *   hasRecording?    — 'yes' (default) | 'no' | 'any'
 *   format?          — 'json' (default) | 'csv'
 *   limit? / offset? — pagination (default 100, max 500)
 */

import { cookies } from 'next/headers';
import type { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type RecordingSource = 'event' | 'session';

interface RecordingRow {
  id: string;
  source: RecordingSource;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  eventType: string;
  eventStartsAt: string;
  startedAt: string;
  durationSeconds: number | null;
  peakParticipants: number;
  recordingUrl: string | null;
  recordingFilename: string | null;
  recordingFileSize: string | null; // BigInt → string
  createdAt: string;
}

function csvEscape(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get('since');
  const untilParam = url.searchParams.get('until');
  const eventId = url.searchParams.get('eventId');
  const hasRecording = (url.searchParams.get('hasRecording') ?? 'yes') as 'yes' | 'no' | 'any';
  const format = url.searchParams.get('format') ?? 'json';
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10),
    MAX_LIMIT,
  );
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 90 * 86400_000);
  const until = untilParam ? new Date(untilParam) : new Date();

  // Pull from both sources. For the "recordings library" use case the
  // user wants everything that has a non-null recordingUrl; we still
  // include the rows without one when hasRecording='no' so the page
  // can double as "which sessions never got recorded".
  const sessionWhere: Prisma.CallSessionWhereInput = {
    startedAt: { gte: since, lte: until },
  };
  if (eventId) sessionWhere.eventId = eventId;
  if (hasRecording === 'yes') sessionWhere.recordingUrl = { not: null };
  if (hasRecording === 'no') sessionWhere.recordingUrl = null;

  const eventWhere: Prisma.EventWhereInput = {
    createdAt: { gte: since, lte: until },
    recordingUrl: { not: null },
  };
  if (eventId) eventWhere.id = eventId;
  // For "hasRecording=no" we deliberately skip the event source: an event
  // without CallSession data doesn't have a meaningful "missing recording"
  // signal to show.
  const includeEventRows = hasRecording !== 'no';

  const [sessions, events] = await Promise.all([
    prisma.callSession.findMany({
      where: sessionWhere,
      orderBy: { startedAt: 'desc' },
      take: format === 'csv' ? MAX_LIMIT : limit,
      skip: format === 'csv' ? 0 : offset,
      include: {
        event: {
          select: { slug: true, title: true, startsAt: true, eventType: true },
        },
      },
    }),
    includeEventRows
      ? prisma.event.findMany({
          where: eventWhere,
          orderBy: { recordingPublishedAt: 'desc' },
          take: format === 'csv' ? MAX_LIMIT : limit,
          skip: format === 'csv' ? 0 : offset,
          select: {
            id: true,
            slug: true,
            title: true,
            eventType: true,
            startsAt: true,
            createdAt: true,
            recordingPublishedAt: true,
            recordingUrl: true,
            recordingDuration: true,
            recordingFileSize: true,
            peakParticipants: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const rows: RecordingRow[] = [
    ...sessions.map<RecordingRow>((s) => ({
      id: `session:${s.id}`,
      source: 'session',
      eventId: s.eventId,
      eventTitle: getLocalized(s.event.title as LocalizedField, 'it'),
      eventSlug: s.event.slug,
      eventType: s.event.eventType,
      eventStartsAt: s.event.startsAt.toISOString(),
      startedAt: s.startedAt.toISOString(),
      durationSeconds: s.duration,
      peakParticipants: s.peakParticipants,
      recordingUrl: s.recordingUrl,
      recordingFilename: s.recordingFilename,
      recordingFileSize: s.recordingFileSize?.toString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
    ...events.map<RecordingRow>((e) => ({
      id: `event:${e.id}`,
      source: 'event',
      eventId: e.id,
      eventTitle: getLocalized(e.title as LocalizedField, 'it'),
      eventSlug: e.slug,
      eventType: e.eventType,
      eventStartsAt: e.startsAt.toISOString(),
      startedAt: (e.recordingPublishedAt ?? e.createdAt).toISOString(),
      durationSeconds: e.recordingDuration,
      peakParticipants: e.peakParticipants,
      recordingUrl: e.recordingUrl,
      recordingFilename: null,
      recordingFileSize: e.recordingFileSize?.toString() ?? null,
      createdAt: (e.recordingPublishedAt ?? e.createdAt).toISOString(),
    })),
  ];

  rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  // Aggregate stats on the filtered set
  const withRecording = rows.filter((r) => r.recordingUrl !== null);
  const totalBytes = withRecording.reduce(
    (a, r) => a + (r.recordingFileSize ? BigInt(r.recordingFileSize) : 0n),
    0n,
  );
  const totalDuration = withRecording.reduce((a, r) => a + (r.durationSeconds ?? 0), 0);

  if (format === 'csv') {
    const header = [
      'source',
      'event_title',
      'event_slug',
      'event_type',
      'started_at',
      'duration_seconds',
      'peak_participants',
      'recording_filename',
      'recording_bytes',
      'recording_url',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.source,
        csvEscape(r.eventTitle),
        r.eventSlug,
        r.eventType,
        r.startedAt,
        r.durationSeconds ?? '',
        r.peakParticipants,
        csvEscape(r.recordingFilename),
        r.recordingFileSize ?? '',
        csvEscape(r.recordingUrl),
      ].join(','));
    }
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="recordings-${since.toISOString().slice(0, 10)}-${until.toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return Response.json(
    {
      rows,
      total: rows.length,
      stats: {
        withRecording: withRecording.length,
        totalBytes: totalBytes.toString(),
        totalDurationSeconds: totalDuration,
      },
      since: since.toISOString(),
      until: until.toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
