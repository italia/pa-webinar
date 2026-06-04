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
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import { generateRecordingSasUrl } from '@/lib/storage/recordings';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

// SAS expiry for inline playback + download links. Long enough that a
// 300 MB file finishes downloading on a slow connection without the
// token expiring mid-transfer, short enough that a stale page load
// doesn't leak long-lived credentials.
const SAS_EXPIRY_MINUTES = 60;

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
  endedAt: string | null;
  durationSeconds: number | null;
  peakParticipants: number;
  recordingUrl: string | null;
  recordingFilename: string | null;
  recordingFileSize: string | null; // BigInt → string
  jitsiRoomName: string | null;
  moderatorName: string | null;
  moderatorEmail: string | null;
  createdAt: string;
  // Stato post-produzione AI (per badge + link alla gestione). null se
  // non esiste una Recording postprod per questa registrazione.
  transcript: { recordingId: string; status: string; hasTranscript: boolean } | null;
}

function postprodInfo(
  rec: { id: string; status: string; artifacts: { id: string }[] } | null | undefined,
): RecordingRow['transcript'] {
  if (!rec) return null;
  return { recordingId: rec.id, status: rec.status, hasTranscript: rec.artifacts.length > 0 };
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
          select: {
            slug: true,
            title: true,
            startsAt: true,
            eventType: true,
            moderatorName: true,
            moderatorEmail: true,
          },
        },
        // Stato post-produzione AI per il badge in lista (link alla
        // pagina di gestione). 1:1 con la CallSession.
        recording: {
          select: {
            id: true,
            status: true,
            artifacts: { where: { type: 'TRANSCRIPT_JSON' }, select: { id: true } },
          },
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
            endsAt: true,
            createdAt: true,
            recordingPublishedAt: true,
            recordingUrl: true,
            recordingDuration: true,
            recordingFileSize: true,
            peakParticipants: true,
            jitsiRoomName: true,
            moderatorName: true,
            moderatorEmail: true,
            recordings: {
              select: {
                id: true,
                status: true,
                artifacts: { where: { type: 'TRANSCRIPT_JSON' }, select: { id: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        })
      : Promise.resolve([]),
  ]);

  // Sign each blob URL with a short-lived read-SAS so the admin can
  // play/download directly from the browser. The storage account has
  // public access disabled, so the bare URL would 403 with
  // `PublicAccessNotPermitted`. Signing per-row (instead of a single
  // endpoint that redirects) lets the browser's video element fetch
  // ranges for scrubbing.
  async function signOrNull(url: string | null): Promise<string | null> {
    if (!url) return null;
    try {
      return await generateRecordingSasUrl(url, SAS_EXPIRY_MINUTES);
    } catch {
      return url;
    }
  }

  const rawRows = [
    ...sessions.map((s) => ({
      id: `session:${s.id}`,
      source: 'session' as const,
      eventId: s.eventId,
      eventTitle: getLocalized(s.event.title as LocalizedField, 'it'),
      eventSlug: s.event.slug,
      eventType: s.event.eventType,
      eventStartsAt: s.event.startsAt.toISOString(),
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      durationSeconds: s.duration,
      peakParticipants: s.peakParticipants,
      recordingUrl: s.recordingUrl,
      recordingFilename: s.recordingFilename,
      recordingFileSize: s.recordingFileSize?.toString() ?? null,
      jitsiRoomName: s.jitsiRoomName,
      moderatorName: s.event.moderatorName,
      moderatorEmail: tryDecryptPII(s.event.moderatorEmail),
      createdAt: s.createdAt.toISOString(),
      transcript: postprodInfo(s.recording),
    })),
    ...events.map((e) => ({
      id: `event:${e.id}`,
      source: 'event' as const,
      eventId: e.id,
      eventTitle: getLocalized(e.title as LocalizedField, 'it'),
      eventSlug: e.slug,
      eventType: e.eventType,
      eventStartsAt: e.startsAt.toISOString(),
      startedAt: (e.recordingPublishedAt ?? e.createdAt).toISOString(),
      endedAt: e.endsAt.toISOString(),
      durationSeconds: e.recordingDuration,
      peakParticipants: e.peakParticipants,
      recordingUrl: e.recordingUrl,
      recordingFilename: null,
      recordingFileSize: e.recordingFileSize?.toString() ?? null,
      jitsiRoomName: e.jitsiRoomName,
      moderatorName: e.moderatorName,
      moderatorEmail: tryDecryptPII(e.moderatorEmail),
      createdAt: (e.recordingPublishedAt ?? e.createdAt).toISOString(),
      transcript: postprodInfo(e.recordings[0] ?? null),
    })),
  ];

  const rows: RecordingRow[] = await Promise.all(
    rawRows.map(async (r) => ({
      ...r,
      recordingUrl: await signOrNull(r.recordingUrl),
    })),
  );

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
