/**
 * Question template item endpoints (admin only).
 *
 * GET    — full template with items (for the edit form).
 * PUT    — partial update. Items are reconciled via shapeTemplateItemsWrite:
 *          items with an id are updated, new items created, existing items
 *          not present in the payload deleted. All in a single transaction.
 * DELETE — rejected if any EventQuestionnaire still links this template, to
 *          avoid silently breaking live questionnaire definitions. System
 *          templates (`isSystem: true`) can never be deleted.
 */

import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { shapeTemplateItemsWrite } from '@/lib/questionnaires';
import { updateQuestionTemplateSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('Template ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const tpl = await prisma.questionTemplate.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { questionnaires: true } },
    },
  });
  if (!tpl) {
    throw new AppError('Template not found', 404, 'NOT_FOUND');
  }

  return Response.json(
    {
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      isSystem: tpl.isSystem,
      sortOrder: tpl.sortOrder,
      usedByQuestionnaires: tpl._count.questionnaires,
      items: tpl.items,
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
  const parsed = updateQuestionTemplateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const data = parsed.data;

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.questionTemplate.findUnique({
      where: { id },
      include: { items: { select: { id: true } } },
    });
    if (!existing) {
      throw new AppError('Template not found', 404, 'NOT_FOUND');
    }

    const itemsWrite = data.items !== undefined
      ? shapeTemplateItemsWrite(data.items, existing.items.map((i) => i.id))
      : null;

    return tx.questionTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(itemsWrite && {
          items: {
            ...(itemsWrite.deleteIds.length > 0 && {
              deleteMany: { id: { in: itemsWrite.deleteIds } },
            }),
            ...(itemsWrite.update.length > 0 && { update: itemsWrite.update }),
            ...(itemsWrite.create.length > 0 && { create: itemsWrite.create }),
          },
        }),
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
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

  const tpl = await prisma.questionTemplate.findUnique({
    where: { id },
    select: { isSystem: true, _count: { select: { questionnaires: true } } },
  });
  if (!tpl) {
    throw new AppError('Template not found', 404, 'NOT_FOUND');
  }
  if (tpl.isSystem) {
    throw new AppError('System templates cannot be deleted', 403, 'FORBIDDEN');
  }
  if (tpl._count.questionnaires > 0) {
    throw new AppError(
      `Template is linked by ${tpl._count.questionnaires} live questionnaire(s). Unlink first.`,
      409,
      'TEMPLATE_IN_USE',
    );
  }

  await prisma.questionTemplate.delete({ where: { id } });

  return Response.json({ deleted: true });
});
