import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { fileDeletionFailed, removeMaterialBlob } from '@/lib/events/material-files';
import { pokeLivePanel } from '@/lib/live-state/publish';

export const dynamic = 'force-dynamic';

// ── DELETE /api/events/[slug]/materials/[id] ─────────────

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: slug, id } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const material = await prisma.eventMaterial.findUnique({ where: { id } });
  if (!material || material.eventId !== event.id) {
    throw new NotFoundError('Material');
  }

  // Un file caricato se ne va con il suo materiale, e prima della riga: se lo
  // storage non risponde il materiale resta e si riprova, invece di lasciare
  // un file che nessuno elencherebbe né cancellerebbe più
  // (lib/events/material-files).
  const file = await removeMaterialBlob(material.blobPath, event.id, { materialIds: [id] });
  if (file === 'failed') throw fileDeletionFailed();
  await prisma.eventMaterial.delete({ where: { id } });

  pokeLivePanel(event.id, 'materials');

  return Response.json({ ok: true });
});
