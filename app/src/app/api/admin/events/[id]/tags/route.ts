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
import { requireEventManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { replaceEventTags, tagIdsFromSlugs } from '@/lib/events/event-tags';
import { AppError, ValidationError } from '@/lib/errors';

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
  const { id } = await context.params;
  // Di chi gestisce l'evento: l'admin, chi l'ha creato o un altro organizzatore (eventScope, ADR-014).
  await requireEventManager(await cookies(), id);
  await loadEvent(id);

  const rows = await prisma.eventTagLink.findMany({
    where: { eventId: id },
    include: { tag: true },
  });

  return Response.json({ rows: rows.map((r) => r.tag) });
});

export const PUT = withErrorHandling(async (request, context) => {
  const { id } = await context.params;
  // Di chi gestisce l'evento: l'admin, chi l'ha creato o un altro organizzatore (eventScope, ADR-014).
  await requireEventManager(await cookies(), id);
  await loadEvent(id);

  const body = await parseJsonBody(request);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const tagIds = await tagIdsFromSlugs(prisma, parsed.data.slugs);
  await prisma.$transaction((tx) => replaceEventTags(tx, id, tagIds));

  await logAdminAction({
    request,
    action: 'EVENT_TAGS_SET',
    target: id,
    details: { slugs: parsed.data.slugs },
  });

  return Response.json({ updated: true, count: tagIds.length });
});
