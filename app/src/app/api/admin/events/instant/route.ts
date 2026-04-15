/**
 * Admin-facing search/list endpoint for INSTANT events (chiamate rapide).
 *
 * Supports free-text search (title + moderatorName), date range,
 * status filter, "has recording" toggle and pagination. Kept separate
 * from /api/events so it can apply admin-only auth and cross-locale
 * title search without disturbing the public event listing.
 */

import { cookies } from 'next/headers';
import type { Prisma, EventStatus } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const STATUS_VALUES: EventStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'PROVISIONING',
  'LIVE',
  'IDLE',
  'ENDED',
  'ARCHIVED',
];

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const statusParam = url.searchParams.get('status')?.toUpperCase() ?? '';
  const hasRec = url.searchParams.get('hasRec'); // 'yes' | 'no' | null
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const where: Prisma.EventWhereInput = { eventType: 'INSTANT' };

  if (q) {
    // Title is stored as JSONB keyed by locale. Prisma doesn't support
    // `contains` on JSON fields with Postgres out of the box in a
    // locale-agnostic way, so we match on moderator name via `contains`
    // and rely on the raw JSON path cast on title. Postgres-specific
    // JSONB text search via `string_contains` works on the root level.
    where.OR = [
      { moderatorName: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q.toLowerCase() } },
      // Fallback: do a raw JSON path search on the title JSON's `it`
      // field (stringified) for case-insensitive matching. Uses the
      // Prisma string_contains filter which compiles to an ILIKE on the
      // text representation of the JSON value.
      { title: { path: ['it'], string_contains: q } },
      { title: { path: ['en'], string_contains: q } },
    ];
  }

  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from);
    if (to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(to);
  }

  if (statusParam && STATUS_VALUES.includes(statusParam as EventStatus)) {
    where.status = statusParam as EventStatus;
  }

  if (hasRec === 'yes') where.recordingUrl = { not: null };
  if (hasRec === 'no') where.recordingUrl = null;

  const [totalCount, rows] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        createdAt: true,
        lastActiveAt: true,
        endsAt: true,
        moderatorName: true,
        moderatorToken: true,
        peakParticipants: true,
        recordingUrl: true,
        recordingDuration: true,
        recordingFileSize: true,
        _count: { select: { callSessions: true, registrations: true } },
      },
    }),
  ]);

  const serialised = rows.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: getLocalized(c.title as LocalizedField, 'it'),
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    lastActiveAt: c.lastActiveAt?.toISOString() ?? null,
    endsAt: c.endsAt.toISOString(),
    moderatorName: c.moderatorName,
    moderatorToken: c.moderatorToken,
    peakParticipants: c.peakParticipants,
    recordingUrl: c.recordingUrl,
    recordingDuration: c.recordingDuration,
    recordingFileSize: c.recordingFileSize?.toString() ?? null,
    callSessionsCount: c._count.callSessions,
    registrationsCount: c._count.registrations,
  }));

  return Response.json(
    {
      rows: serialised,
      total: totalCount,
      limit,
      offset,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
