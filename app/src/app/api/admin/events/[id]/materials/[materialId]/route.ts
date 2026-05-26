/**
 * Admin-authenticated per-material operations: PATCH + DELETE.
 *
 * Both handlers require an admin_session cookie and verify that the
 * target material belongs to the target event before mutating.
 */

import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { updateMaterialAdminSchema } from '@/lib/validation/materials';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MaterialRow {
  id: string;
  eventId: string;
  type: string;
  title: string;
  url: string;
  description: string | null;
  addedBy: string;
  fileName: string | null;
  fileSize: bigint | null;
  mimeType: string | null;
  blobPath: string | null;
  visibility: string;
  createdAt: Date;
}

function serializeMaterial(m: MaterialRow) {
  return {
    id: m.id,
    eventId: m.eventId,
    type: m.type,
    title: m.title,
    url: m.url,
    description: m.description,
    addedBy: m.addedBy,
    fileName: m.fileName,
    fileSize: m.fileSize !== null ? Number(m.fileSize) : null,
    mimeType: m.mimeType,
    blobPath: m.blobPath,
    visibility: m.visibility,
    createdAt: m.createdAt.toISOString(),
  };
}

async function ensureAdminAndIds(
  context: { params: Promise<{ id: string; materialId: string }> },
) {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id, materialId } = await context.params;
  if (!UUID_RE.test(id) || !UUID_RE.test(materialId)) {
    throw new AppError('Event and material IDs must be UUIDs', 400, 'BAD_REQUEST');
  }
  return { id, materialId };
}

// ── PATCH /api/admin/events/[id]/materials/[materialId] ────

export const PATCH = withErrorHandling(async (request, context) => {
  const { id, materialId } = await ensureAdminAndIds(context);

  const existing = await prisma.eventMaterial.findUnique({
    where: { id: materialId },
  });
  if (!existing || existing.eventId !== id) {
    throw new NotFoundError('Material');
  }

  const body = await parseJsonBody(request);
  const parsed = updateMaterialAdminSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.url !== undefined) data.url = parsed.data.url;
  if (parsed.data.description !== undefined) {
    data.description = parsed.data.description ?? null;
  }
  if (parsed.data.type !== undefined) data.type = parsed.data.type;
  if (parsed.data.fileName !== undefined) data.fileName = parsed.data.fileName ?? null;
  if (parsed.data.fileSize !== undefined) {
    data.fileSize =
      parsed.data.fileSize == null ? null : BigInt(parsed.data.fileSize);
  }
  if (parsed.data.mimeType !== undefined) data.mimeType = parsed.data.mimeType ?? null;
  if (parsed.data.blobPath !== undefined) data.blobPath = parsed.data.blobPath ?? null;
  if (parsed.data.visibility !== undefined) data.visibility = parsed.data.visibility;

  const updated = await prisma.eventMaterial.update({
    where: { id: materialId },
    data,
  });

  await logAdminAction({
    request,
    action: 'EVENT_MATERIAL_UPDATE',
    target: materialId,
    details: { eventId: id, fields: Object.keys(parsed.data) },
  });

  return Response.json(serializeMaterial(updated));
});

// ── DELETE /api/admin/events/[id]/materials/[materialId] ───

export const DELETE = withErrorHandling(async (request, context) => {
  const { id, materialId } = await ensureAdminAndIds(context);

  const existing = await prisma.eventMaterial.findUnique({
    where: { id: materialId },
    select: { id: true, eventId: true },
  });
  if (!existing || existing.eventId !== id) {
    throw new NotFoundError('Material');
  }

  await prisma.eventMaterial.delete({ where: { id: materialId } });

  await logAdminAction({
    request,
    action: 'EVENT_MATERIAL_DELETE',
    target: materialId,
    details: { eventId: id },
  });

  return Response.json({ ok: true });
});
