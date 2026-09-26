/**
 * Admin-authenticated event materials: list + create.
 *
 * Mirrors the public `/api/events/[slug]/materials` endpoint but is
 * gated by the admin_session cookie (not a moderator token), so admins
 * can manage materials from the admin UI without juggling tokens.
 *
 * The event parameter here is always a UUID (not a slug) to match the
 * admin routing convention (`/admin/events/[id]/…`).
 */

import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { requireEventManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, ValidationError } from '@/lib/errors';
import { materialAddedBy } from '@/lib/events/material-author';
import { materialBlobClaimProblem, materialBlobPathProblem } from '@/lib/events/material-files';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { createMaterialAdminSchema } from '@/lib/validation/materials';

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

// ── GET /api/admin/events/[id]/materials ───────────────────

export const GET = withErrorHandling(async (_request, context) => {
  const { id } = await context.params;
  // Dell'evento: l'admin, o l'organizzatore che l'ha creato (ADR-014).
  await requireEventManager(await cookies(), id);
  if (!UUID_RE.test(id)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const materials = await prisma.eventMaterial.findMany({
    where: { eventId: id },
    orderBy: { createdAt: 'desc' },
  });

  return Response.json(
    { materials: materials.map(serializeMaterial) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

// ── POST /api/admin/events/[id]/materials ──────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { id } = await context.params;
  // Dell'evento: l'admin, o l'organizzatore che l'ha creato (ADR-014).
  await requireEventManager(await cookies(), id);
  if (!UUID_RE.test(id)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const body = await parseJsonBody(request);
  const parsed = createMaterialAdminSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  // Il file di un materiale si cancella con il materiale: lo tiene solo un
  // FILE, la chiave deve essere quella di un documento caricato, il file che
  // l'URL serve, e un file che nessun altro usa già (lib/events/material-files),
  // non un blob qualunque dello storage.
  if (parsed.data.blobPath) {
    const problem =
      parsed.data.type !== 'FILE'
        ? 'Only a FILE material holds an uploaded file'
        : (materialBlobPathProblem(parsed.data.blobPath, parsed.data.url) ??
          (await materialBlobClaimProblem(parsed.data.blobPath)));
    if (problem) {
      throw new ValidationError('Validation failed', [{ path: ['blobPath'], message: problem }]);
    }
  }

  const material = await prisma.eventMaterial.create({
    data: {
      eventId: id,
      type: parsed.data.type,
      title: parsed.data.title,
      url: parsed.data.url,
      description: parsed.data.description ?? null,
      // Chi lo aggiunge da qui e' lo staff, non chi conduce: nessun nome, e
      // ogni superficie mostra la dicitura tradotta (lib/events/material-author).
      addedBy: materialAddedBy(null),
      fileName: parsed.data.fileName ?? null,
      fileSize: parsed.data.fileSize != null ? BigInt(parsed.data.fileSize) : null,
      mimeType: parsed.data.mimeType ?? null,
      blobPath: parsed.data.blobPath ?? null,
      visibility: parsed.data.visibility,
    },
  });

  await logAdminAction({
    request,
    action: 'EVENT_MATERIAL_CREATE',
    target: material.id,
    details: { eventId: id, type: material.type },
  });

  // Se la sala è aperta, il pannello «Materiali» rilegge subito.
  pokeLivePanel(id, 'materials');

  return Response.json(serializeMaterial(material), { status: 201 });
});
