/**
 * Admin: tag assignment on an event.
 *
 *   GET — list tags currently attached to the event
 *   PUT — replace the event's tag set with the given slug list (idempotent)
 *
 * Accepts slugs (not UUIDs) so the wizard UI can reference stable tag
 * identifiers. Unknown slugs are silently dropped — the client-facing tag
 * CRUD lives at /api/admin/tags and is where missing tags should be
 * created first.
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

const putSchema = z.object({
  slugs: z.array(z.string().min(1).max(100)).max(30),
});

async function loadEvent(id: string) {
  if (!UUID_RE.test(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
  return event;
}

export const GET = withErrorHandling(async (_request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await context.params;
  await loadEvent(id);

  const rows = await prisma.eventTagLink.findMany({
    where: { eventId: id },
    include: { tag: true },
  });

  return Response.json({ rows: rows.map((r) => r.tag) });
});

export const PUT = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await context.params;
  await loadEvent(id);

  const body = await parseJsonBody(request);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const tags = parsed.data.slugs.length
    ? await prisma.tag.findMany({ where: { slug: { in: parsed.data.slugs } }, select: { id: true } })
    : [];

  await prisma.$transaction([
    prisma.eventTagLink.deleteMany({ where: { eventId: id } }),
    prisma.eventTagLink.createMany({
      data: tags.map((t) => ({ eventId: id, tagId: t.id })),
      skipDuplicates: true,
    }),
  ]);

  await logAdminAction({
    request,
    action: 'EVENT_TAGS_SET',
    target: id,
    details: { slugs: parsed.data.slugs },
  });

  return Response.json({ updated: true, count: tags.length });
});
