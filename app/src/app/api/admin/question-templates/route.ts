/**
 * Question template collection endpoints (admin only).
 *
 * GET  — list all templates with item counts and how many live event
 *        questionnaires reference them (so the UI can warn before delete).
 * POST — create a template with its initial items in a single write.
 */

import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { shapeTemplateItemsWrite } from '@/lib/questionnaires';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { createQuestionTemplateSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async () => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const rows = await prisma.questionTemplate.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { items: true, questionnaires: true } },
    },
  });

  return Response.json(
    {
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        sortOrder: r.sortOrder,
        itemCount: r._count.items,
        usedByQuestionnaires: r._count.questionnaires,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const POST = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const body = await parseJsonBody(request);
  const parsed = createQuestionTemplateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const data = parsed.data;

  const { create } = shapeTemplateItemsWrite(data.items ?? [], []);

  const created = await prisma.questionTemplate.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      sortOrder: data.sortOrder ?? 0,
      items: { create },
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  await logAdminAction({
    request,
    action: 'QUESTION_TEMPLATE_CREATE',
    target: created.id,
  });

  return Response.json(created, { status: 201 });
});
