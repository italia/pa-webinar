/**
 * GDPR template item endpoints (admin only).
 *
 * PUT    — partial update. Same default-switchover logic as POST so the
 *          one-default invariant is preserved when an admin flips a
 *          non-default template to default from the edit form.
 * DELETE — allowed even when events reference the template; the FK is
 *          `ON DELETE SET NULL` so the events keep their ad-hoc text
 *          (or fall back to the next selected template). We return
 *          how many events were unlinked so the UI can show a hint.
 */

import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { updateGdprTemplateSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('Template ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const tpl = await prisma.gdprTemplate.findUnique({
    where: { id },
    include: { _count: { select: { events: true } } },
  });
  if (!tpl) {
    throw new AppError('Template not found', 404, 'NOT_FOUND');
  }

  return Response.json(
    {
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      body: tpl.body,
      isDefault: tpl.isDefault,
      usedByEvents: tpl._count.events,
      createdAt: tpl.createdAt.toISOString(),
      updatedAt: tpl.updatedAt.toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const PUT = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('Template ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const body = await parseJsonBody(request);
  const parsed = updateGdprTemplateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const data = parsed.data;

  const updated = await prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.gdprTemplate.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.gdprTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.body !== undefined && { body: data.body }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
      },
    });
  });

  return Response.json(updated);
});

export const DELETE = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('Template ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const unlinkedCount = await prisma.event.count({
    where: { gdprTemplateId: id },
  });

  await prisma.gdprTemplate.delete({ where: { id } });

  return Response.json({ deleted: true, unlinkedEvents: unlinkedCount });
});
