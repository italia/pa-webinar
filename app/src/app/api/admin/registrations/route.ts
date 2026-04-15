/**
 * Admin cross-event registrations list.
 *
 * Supports filtering by event, time range and organization type plus
 * CSV export. Deliberately keeps PII server-side: the email field is
 * encrypted at rest and we return a best-effort decrypted value only
 * when the admin is authenticated.
 *
 * GET params:
 *   eventId?    — filter to a single event
 *   since?      — ISO datetime, default 30 days ago
 *   until?      — ISO datetime, default now
 *   orgType?    — OrganizationType enum value
 *   joined?     — 'yes' | 'no' (filter by joinedAt)
 *   format?     — 'json' (default) | 'csv'
 *   limit?      — default 200, max 1000
 *   offset?     — pagination offset
 */

import { cookies } from 'next/headers';
import type { OrganizationType, Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { decryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

interface RegistrationRow {
  id: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  eventStartsAt: string;
  displayName: string;
  email: string;
  organization: string | null;
  organizationRole: string | null;
  organizationType: string | null;
  consentRecording: boolean | null;
  consentFutureCommunications: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  createdAt: string;
}

function bestEffortDecrypt(cipher: string): string {
  try {
    return decryptPII(cipher);
  } catch {
    return '***decrypt-error***';
  }
}

function csvEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const sinceParam = url.searchParams.get('since');
  const untilParam = url.searchParams.get('until');
  const orgTypeParam = url.searchParams.get('orgType');
  const joined = url.searchParams.get('joined');
  const format = url.searchParams.get('format') ?? 'json';
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10),
    MAX_LIMIT,
  );
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 30 * 86400_000);
  const until = untilParam ? new Date(untilParam) : new Date();

  const where: Prisma.RegistrationWhereInput = {
    createdAt: { gte: since, lte: until },
  };
  if (eventId) where.eventId = eventId;
  if (orgTypeParam) where.organizationType = orgTypeParam as OrganizationType;
  if (joined === 'yes') where.joinedAt = { not: null };
  else if (joined === 'no') where.joinedAt = null;

  const [rows, total, orgTypeCounts] = await Promise.all([
    prisma.registration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: format === 'csv' ? MAX_LIMIT : limit,
      skip: format === 'csv' ? 0 : offset,
      include: {
        event: { select: { slug: true, title: true, startsAt: true } },
      },
    }),
    prisma.registration.count({ where }),
    prisma.registration.groupBy({
      by: ['organizationType'],
      where,
      _count: { id: true },
    }),
  ]);

  const mapped: RegistrationRow[] = rows.map((r) => ({
    id: r.id,
    eventId: r.eventId,
    eventTitle: getLocalized(r.event.title as LocalizedField, 'it'),
    eventSlug: r.event.slug,
    eventStartsAt: r.event.startsAt.toISOString(),
    displayName: r.displayName,
    email: bestEffortDecrypt(r.email),
    organization: r.organization,
    organizationRole: r.organizationRole,
    organizationType: r.organizationType,
    consentRecording: r.consentRecording,
    consentFutureCommunications: r.consentFutureCommunications,
    joinedAt: r.joinedAt?.toISOString() ?? null,
    leftAt: r.leftAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  if (format === 'csv') {
    const header = [
      'created_at',
      'event_title',
      'event_slug',
      'event_starts_at',
      'display_name',
      'email',
      'organization',
      'organization_role',
      'organization_type',
      'consent_recording',
      'consent_future_communications',
      'joined',
    ];
    const lines = [header.join(',')];
    for (const r of mapped) {
      lines.push([
        r.createdAt,
        csvEscape(r.eventTitle),
        r.eventSlug,
        r.eventStartsAt,
        csvEscape(r.displayName),
        csvEscape(r.email),
        csvEscape(r.organization),
        csvEscape(r.organizationRole),
        r.organizationType ?? '',
        r.consentRecording === null ? '' : r.consentRecording ? 'yes' : 'no',
        r.consentFutureCommunications ? 'yes' : 'no',
        r.joinedAt ? 'yes' : 'no',
      ].join(','));
    }
    const body = lines.join('\n');
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="registrations-${since.toISOString().slice(0, 10)}-${until.toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const orgSummary: Record<string, number> = {};
  for (const row of orgTypeCounts) {
    const k = row.organizationType ?? 'UNKNOWN';
    orgSummary[k] = row._count.id;
  }

  return Response.json(
    {
      rows: mapped,
      total,
      limit,
      offset,
      since: since.toISOString(),
      until: until.toISOString(),
      orgSummary,
      joinedCount: mapped.filter((r) => r.joinedAt !== null).length,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
