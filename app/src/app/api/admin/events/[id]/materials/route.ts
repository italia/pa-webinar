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
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';
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
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
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
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, moderatorName: true },
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

  const material = await prisma.eventMaterial.create({
    data: {
      eventId: id,
      type: parsed.data.type,
      title: parsed.data.title,
      url: parsed.data.url,
      description: parsed.data.description ?? null,
      addedBy: event.moderatorName ?? 'Admin',
      fileName: parsed.data.fileName ?? null,
      fileSize: parsed.data.fileSize != null ? BigInt(parsed.data.fileSize) : null,
      mimeType: parsed.data.mimeType ?? null,
      blobPath: parsed.data.blobPath ?? null,
      visibility: parsed.data.visibility,
    },
  });

  return Response.json(serializeMaterial(material), { status: 201 });
});
