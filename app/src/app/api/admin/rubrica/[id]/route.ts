/**
 * Admin rubrica person detail.
 *
 * GET    returns the Person record plus a list of registrations linked
 *        to this person (event title, slug, startsAt, createdAt,
 *        organization snapshot at the time).
 *
 * DELETE hard-deletes the Person record (GDPR Art. 17 — right to be
 *        forgotten). Registrations keep existing but their personId is
 *        cleared via onDelete: SetNull. Event-level consent records are
 *        unaffected.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (_request, context: { params: Promise<{ id: string }> }) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      registrations: {
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          event: { select: { slug: true, title: true, startsAt: true } },
        },
      },
    },
  });
  if (!person) throw new NotFoundError('Person');

  return Response.json(
    {
      id: person.id,
      displayName: person.displayName,
      organization: person.organization,
      organizationRole: person.organizationRole,
      organizationType: person.organizationType,
      optedInToAddressBook: person.optedInToAddressBook,
      optedInAt: person.optedInAt?.toISOString() ?? null,
      optedOutAt: person.optedOutAt?.toISOString() ?? null,
      lastActiveAt: person.lastActiveAt.toISOString(),
      retentionMonths: person.retentionMonths,
      createdAt: person.createdAt.toISOString(),
      updatedAt: person.updatedAt.toISOString(),
      registrations: person.registrations.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        organization: r.organization,
        organizationRole: r.organizationRole,
        organizationType: r.organizationType,
        event: {
          slug: r.event.slug,
          title: r.event.title,
          startsAt: r.event.startsAt.toISOString(),
        },
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const DELETE = withErrorHandling(async (_request, context: { params: Promise<{ id: string }> }) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  const existing = await prisma.person.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError('Person');

  await prisma.person.delete({ where: { id } });

  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
});
