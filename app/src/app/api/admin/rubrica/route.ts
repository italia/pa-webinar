/**
 * Admin rubrica (address book) list.
 *
 * Returns all Person rows currently opted in to the cross-event address
 * book. This is the people directory, independent of a single event
 * registration. Supports filtering by organization type, text search
 * (displayName / organization), and inactivity window.
 *
 * GET params:
 *   q?          — case-insensitive substring match on displayName or organization
 *   orgType?    — OrganizationType enum value
 *   includeOpted?  — 'out' to include opted-out persons (default: only opted-in).
 *                   Admin-side pickers (e.g. event wizard rubrica picker) may
 *                   pass this flag to surface persons that have not yet opted in
 *                   to the cross-event address book.
 *   limit?      — default 200, max 1000
 *   offset?     — pagination offset
 */

import { cookies } from 'next/headers';
import type { OrganizationType, Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const orgTypeParam = url.searchParams.get('orgType');
  const includeOpted = url.searchParams.get('includeOpted');
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10),
    MAX_LIMIT,
  );
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const where: Prisma.PersonWhereInput = {};
  if (includeOpted !== 'out') where.optedInToAddressBook = true;
  if (orgTypeParam) where.organizationType = orgTypeParam as OrganizationType;
  if (q) {
    where.OR = [
      { displayName: { contains: q, mode: 'insensitive' } },
      { organization: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.person.findMany({
      where,
      orderBy: [{ lastActiveAt: 'desc' }, { displayName: 'asc' }],
      take: limit,
      skip: offset,
      select: {
        id: true,
        displayName: true,
        organization: true,
        organizationRole: true,
        organizationType: true,
        optedInToAddressBook: true,
        optedInAt: true,
        optedOutAt: true,
        lastActiveAt: true,
        retentionMonths: true,
        createdAt: true,
        _count: { select: { registrations: true } },
      },
    }),
    prisma.person.count({ where }),
  ]);

  return Response.json(
    {
      rows: rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        organization: r.organization,
        organizationRole: r.organizationRole,
        organizationType: r.organizationType,
        optedInToAddressBook: r.optedInToAddressBook,
        optedInAt: r.optedInAt?.toISOString() ?? null,
        optedOutAt: r.optedOutAt?.toISOString() ?? null,
        lastActiveAt: r.lastActiveAt.toISOString(),
        retentionMonths: r.retentionMonths,
        createdAt: r.createdAt.toISOString(),
        registrationCount: r._count.registrations,
      })),
      total,
      limit,
      offset,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
