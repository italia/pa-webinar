/**
 * Cross-event GDPR audit log.
 *
 * Exposes GdprAuditLog rows to the admin so we have a single place to
 * answer "when did we delete X / export Y / record consent from Z".
 * No PII in the details field (the model enforces this with a comment
 * but we don't rewrite it here — just trust the producers).
 */

import { cookies } from 'next/headers';
import type { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get('since');
  const eventId = url.searchParams.get('eventId');
  const action = url.searchParams.get('action');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10), 1000);

  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 90 * 86400_000);

  const where: Prisma.GdprAuditLogWhereInput = {
    createdAt: { gte: since },
  };
  if (eventId) where.eventId = eventId;
  if (action) where.action = action;

  const [rows, actionCounts] = await Promise.all([
    prisma.gdprAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        event: { select: { slug: true, title: true } },
      },
    }),
    prisma.gdprAuditLog.groupBy({
      by: ['action'],
      where,
      _count: { id: true },
      _sum: { recordCount: true },
    }),
  ]);

  return Response.json(
    {
      rows: rows.map((r) => ({
        id: r.id,
        action: r.action,
        recordCount: r.recordCount,
        details: r.details,
        createdAt: r.createdAt.toISOString(),
        eventId: r.eventId,
        eventSlug: r.event.slug,
        eventTitle: getLocalized(r.event.title as LocalizedField, 'it'),
      })),
      actionSummary: actionCounts.map((a) => ({
        action: a.action,
        count: a._count.id,
        totalRecords: a._sum.recordCount ?? 0,
      })),
      since: since.toISOString(),
      limit,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
