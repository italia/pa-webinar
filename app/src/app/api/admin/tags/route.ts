/**
 * Admin tags taxonomy.
 *
 *   GET  — list all tags (sorted by sortOrder, then slug)
 *   POST — create a tag (slug + multilingual name + optional color)
 *
 * Tags are used for filtering on the public /eventi list and for rendering
 * colored badges on event cards. Association to events lives in
 * `event_tag_links` and is edited via the event wizard (step 1) or the
 * dedicated `/api/admin/events/[id]/tags` endpoint.
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const createSchema = z.object({
  slug: z.string().min(1).max(100).regex(SLUG_RE, 'lowercase slug only (a-z, 0-9, -)'),
  name: z.record(z.string(), z.string().min(1).max(80)).refine(
    (obj) => typeof obj.it === 'string' && obj.it.length >= 1,
    { message: 'name.it is required' },
  ),
  color: z.string().regex(HEX_COLOR_RE, 'hex color like #004080').nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const GET = withErrorHandling(async () => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();

  const rows = await prisma.tag.findMany({
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
  });

  return Response.json({ rows });
});

export const POST = withErrorHandling(async (request) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();

  const body = await parseJsonBody(request);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  try {
    const created = await prisma.tag.create({
      data: {
        slug: parsed.data.slug,
        name: parsed.data.name,
        color: parsed.data.color ?? null,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });
    return Response.json(created, { status: 201 });
  } catch (e: unknown) {
    if (typeof e === 'object' && e && 'code' in e && (e as { code: string }).code === 'P2002') {
      throw new AppError('A tag with that slug already exists', 409, 'CONFLICT');
    }
    throw e;
  }
});
