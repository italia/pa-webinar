/**
 * Admin: single tag.
 *
 *   PATCH  — edit slug / name / color / sortOrder
 *   DELETE — remove tag (cascade removes event_tag_links)
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const patchSchema = z.object({
  slug: z.string().min(1).max(100).regex(SLUG_RE).optional(),
  name: z.record(z.string(), z.string().min(1).max(80)).optional(),
  color: z.string().regex(HEX_COLOR_RE).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const PATCH = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');

  const body = await parseJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  try {
    const updated = await prisma.tag.update({ where: { id }, data: parsed.data });
    await logAdminAction({
      request,
      action: 'TAG_UPDATE',
      target: updated.id,
      details: { fields: Object.keys(parsed.data) },
    });
    return Response.json(updated);
  } catch (e: unknown) {
    if (typeof e === 'object' && e && 'code' in e) {
      const code = (e as { code: string }).code;
      if (code === 'P2002') throw new AppError('Slug already used', 409, 'CONFLICT');
      if (code === 'P2025') throw new AppError('Tag not found', 404, 'NOT_FOUND');
    }
    throw e;
  }
});

export const DELETE = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');

  try {
    await prisma.tag.delete({ where: { id } });
  } catch (e: unknown) {
    if (typeof e === 'object' && e && 'code' in e && (e as { code: string }).code === 'P2025') {
      throw new AppError('Tag not found', 404, 'NOT_FOUND');
    }
    throw e;
  }

  await logAdminAction({ request, action: 'TAG_DELETE', target: id });

  return Response.json({ deleted: true, id });
});
