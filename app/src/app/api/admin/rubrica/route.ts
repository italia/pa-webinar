/**
 * Admin rubrica (address book) list.
 *
 * Returns all Person rows currently opted in to the cross-event address
 * book. This is the people directory, independent of a single event
 * registration. Supports filtering by organization type, text search
 * (organization only — see trade-off below), and inactivity window.
 *
 * GET params:
 *   q?          — case-insensitive substring match on organization only.
 *                 displayName is encrypted at rest (AES-256-GCM); a
 *                 `contains` query against ciphertext is meaningless, so
 *                 we drop that clause (same trade-off taken for
 *                 moderatorEmail in the moderators admin route). If we
 *                 ever need full-text rubrica search we'll add a
 *                 deterministic hash column for equality lookup, but
 *                 substring search on encrypted PII is out of scope.
 *   orgType?    — OrganizationType enum value
 *   includeOpted?  — 'out' to include opted-out persons (default: only
 *                   opted-in). The address-book page uses it to manage every
 *                   entry; the event wizard's picker never does.
 *   withEmail?  — '1' to add each person's email, from their latest
 *                 registration (decrypted): the wizard picker needs it to add
 *                 the person to an event. Only persons that still have a
 *                 registration are returned (cleanup deletes registrations
 *                 before the address-book entry). Admin only, like the route.
 *   limit?      — default 200, max 1000
 *   offset?     — pagination offset
 */

import { cookies } from 'next/headers';
import type { OrganizationType, Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { tryDecryptPII } from '@/lib/crypto/pii';
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
  const withEmail = url.searchParams.get('withEmail') === '1';
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10),
    MAX_LIMIT,
  );
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const where: Prisma.PersonWhereInput = {};
  if (includeOpted !== 'out') where.optedInToAddressBook = true;
  if (orgTypeParam) where.organizationType = orgTypeParam as OrganizationType;
  // Senza un'iscrizione non c'e' un indirizzo: la persona non si potrebbe
  // aggiungere a un evento, e il selettore non la propone.
  if (withEmail) where.registrations = { some: {} };
  if (q) {
    // displayName is stored encrypted at rest, so a `contains` clause on
    // ciphertext would never match. We drop the displayName search and
    // keep substring matching on `organization` only. Same trade-off as
    // the moderators admin route after moderatorEmail was encrypted.
    where.organization = { contains: q, mode: 'insensitive' };
  }

  const [rows, total] = await Promise.all([
    prisma.person.findMany({
      where,
      // Sort by lastActiveAt only — alphabetical sort on encrypted
      // displayName is meaningless (ciphertext order is random).
      orderBy: [{ lastActiveAt: 'desc' }],
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

  // L'email dell'ultima iscrizione di ciascuno, in una lettura sola.
  const emailPerPersona = new Map<string, string | null>();
  if (withEmail && rows.length > 0) {
    const ultime = await prisma.$queryRaw<Array<{ person_id: string; email: string }>>`
      SELECT DISTINCT ON (person_id) person_id, email
      FROM registrations
      WHERE person_id = ANY(${rows.map((r) => r.id)}::uuid[])
      ORDER BY person_id, created_at DESC`;
    for (const u of ultime) emailPerPersona.set(u.person_id, tryDecryptPII(u.email));
  }

  return Response.json(
    {
      rows: rows.map((r) => ({
        id: r.id,
        displayName: tryDecryptPII(r.displayName),
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
        ...(withEmail ? { email: emailPerPersona.get(r.id) ?? null } : {}),
      })),
      total,
      limit,
      offset,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
