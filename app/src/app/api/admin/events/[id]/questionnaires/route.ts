/**
 * List both placements of questionnaires attached to an event. Returns
 * an array with at most two entries (PRE_REGISTRATION, POST_EVENT) —
 * whichever are configured. Missing placements are simply absent.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const rows = await prisma.eventQuestionnaire.findMany({
    where: { eventId: id },
    orderBy: { placement: 'asc' },
    include: {
      templates: {
        orderBy: { sortOrder: 'asc' },
        include: { template: { select: { id: true, name: true } } },
      },
      adhocItems: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { responses: true } },
    },
  });

  return Response.json(
    {
      rows: rows.map((q) => ({
        id: q.id,
        placement: q.placement,
        title: q.title,
        description: q.description,
        required: q.required,
        allowEdit: q.allowEdit,
        templates: q.templates.map((l) => ({
          id: l.template.id,
          name: l.template.name,
          sortOrder: l.sortOrder,
        })),
        adhocItems: q.adhocItems,
        responseCount: q._count.responses,
        createdAt: q.createdAt.toISOString(),
        updatedAt: q.updatedAt.toISOString(),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
