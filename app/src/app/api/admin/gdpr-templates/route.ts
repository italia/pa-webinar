/**
 * GDPR template collection endpoints (admin only).
 *
 * GET  — list templates (name + description + isDefault + locales, no body
 *        to keep listings cheap; full body fetched on [id] route).
 * POST — create a template. If `isDefault: true` we clear the flag on any
 *        previously-default template in the same transaction so the
 *        partial unique index is not violated.
 */

import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { createGdprTemplateSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async () => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const rows = await prisma.gdprTemplate.findMany({
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      body: true,
      isDefault: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { events: true } },
    },
  });

  return Response.json(
    {
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        body: r.body,
        locales: Object.keys(r.body as Record<string, string>),
        isDefault: r.isDefault,
        usedByEvents: r._count.events,
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
  const parsed = createGdprTemplateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const data = parsed.data;

  const created = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.gdprTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.gdprTemplate.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        body: data.body,
        isDefault: data.isDefault ?? false,
      },
    });
  });

  await logAdminAction({
    request,
    action: 'GDPR_TEMPLATE_CREATE',
    target: created.id,
    details: { isDefault: created.isDefault },
  });

  return Response.json(created, { status: 201 });
});
