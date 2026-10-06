import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { NotFoundError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { fileDeletionFailed, removeMaterialBlob } from '@/lib/events/material-files';
import { roomMaterialJson } from '@/lib/events/material-json';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { updateMaterialRoomSchema } from '@/lib/validation/materials';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── PATCH /api/events/[slug]/materials/[id] ──────────────

/**
 * Chi conduce corregge un materiale dalla sala: titolo, descrizione e fase in
 * cui il pubblico lo vede (lib/validation/materials, updateMaterialRoomSchema).
 * Stessa autorizzazione della cancellazione: token moderatore primario o
 * co-moderatore non revocato, mai un relatore. Il pannello di chi è in sala
 * rilegge subito, ognuno con i propri permessi: cambiare la fase può farlo
 * comparire o sparire per il pubblico.
 */
export const PATCH = withErrorHandling(async (request, context) => {
  const { param: slug, id } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const parsed = updateMaterialRoomSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  // Un id che non è un UUID non è di nessun materiale (e la colonna lo
  // rifiuterebbe con un 500).
  const material = UUID_RE.test(id)
    ? await prisma.eventMaterial.findUnique({ where: { id }, select: { id: true, eventId: true } })
    : null;
  if (!material || material.eventId !== event.id) {
    throw new NotFoundError('Material');
  }

  const { title, description, visibility } = parsed.data;
  const updated = await prisma.eventMaterial.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      // Una descrizione vuota la toglie.
      ...(description !== undefined ? { description: description || null } : {}),
      ...(visibility !== undefined ? { visibility } : {}),
    },
  });

  pokeLivePanel(event.id, 'materials');

  // Chi modifica conduce la sala: la risposta è quella dell'elenco completo.
  return Response.json(roomMaterialJson(updated, { seesAll: true }));
});

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
