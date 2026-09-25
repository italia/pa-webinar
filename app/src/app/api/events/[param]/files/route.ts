import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import {
  extractModeratorToken,
  verifyModeratorToken,
} from '@/lib/auth/moderator';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { RateLimitError, UnauthorizedError, ValidationError, NotFoundError } from '@/lib/errors';
import {
  isAzureConfigured,
  generateUploadSasUrl,
  getBlobPath,
  ensureContainer,
} from '@/lib/azure/blob-storage';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { getFilesStorage } from '@/lib/storage';
import { isEventPubliclyVisible } from '@/lib/events/visibility';
import { MATERIAL_ACCESS_EVENT_SELECT, materialsWhereFor } from '@/lib/events/material-access';
import { fileDeletionFailed, removeMaterialBlob } from '@/lib/events/material-files';

const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  title: z.string().min(1).max(300),
  description: z.string().max(500).optional(),
  mimeType: z.string().max(100).optional(),
  fileSize: z.number().int().positive().optional(),
  visibility: z.enum(['ALWAYS', 'BEFORE', 'DURING', 'AFTER']).optional(),
});

export const GET = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ param: string }> },
  ) => {
    const { param } = await context.params;

    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const where = UUID_RE.test(param)
      ? { OR: [{ id: param }, { slug: param }] }
      : { slug: param };

    const event = await prisma.event.findFirst({
      where,
      select: {
        ...MATERIAL_ACCESS_EVENT_SELECT,
        eventType: true,
        postEventPublic: true,
        postEventPublicUntil: true,
      },
    });

    // Stessa soglia dell'elenco dei materiali: un evento che non ha una
    // pagina pubblica (bozza, post-evento spento) non espone i suoi file.
    if (!event || !isEventPubliclyVisible(event)) {
      throw new NotFoundError('Event not found');
    }

    // Visibilità per fase per il pubblico, tutto per chi ha un token
    // moderatore (lib/events/material-access).
    const materials = await prisma.eventMaterial.findMany({
      where: {
        ...(await materialsWhereFor(event, extractModeratorToken(request))),
        type: 'FILE',
      },
      orderBy: { createdAt: 'desc' },
    });

    // Campi esposti uno per uno: `blobPath` è il percorso interno nello
    // storage e resta sul server; `fileSize` è un BigInt, che JSON non
    // serializza, e viaggia come stringa come nella risposta del POST.
    return NextResponse.json(
      materials.map((m) => ({
        id: m.id,
        type: m.type,
        title: m.title,
        url: m.url,
        description: m.description,
        fileName: m.fileName,
        fileSize: m.fileSize?.toString() ?? null,
        mimeType: m.mimeType,
        visibility: m.visibility,
        addedBy: m.addedBy,
        createdAt: m.createdAt.toISOString(),
      })),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  },
);

export const POST = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ param: string }> },
  ) => {
    const { param } = await context.params;
    const token = extractModeratorToken(request);
    if (!token) throw new UnauthorizedError();

    const event = await verifyModeratorToken(param, token);
    if (!event) throw new UnauthorizedError();

    const ip = getClientIp(request);
    const rl = rateLimit(`files-upload:${ip}:${event.id}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
    }

    if (!isAzureConfigured()) {
      return NextResponse.json(
        { error: 'Azure Blob Storage is not configured' },
        { status: 503 },
      );
    }

    const body = await parseJsonBody(request);
    const parsed = uploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }

    await ensureContainer();

    const blobPath = getBlobPath(event.id, parsed.data.fileName);
    const uploadUrl = await generateUploadSasUrl(blobPath);

    const material = await prisma.eventMaterial.create({
      data: {
        eventId: event.id,
        type: 'FILE',
        title: parsed.data.title,
        url: '',
        description: parsed.data.description,
        addedBy: 'moderator',
        fileName: parsed.data.fileName,
        fileSize: parsed.data.fileSize
          ? BigInt(parsed.data.fileSize)
          : null,
        mimeType: parsed.data.mimeType,
        blobPath,
        visibility: parsed.data.visibility ?? 'ALWAYS',
      },
    });

    return NextResponse.json(
      {
        material: { ...material, fileSize: material.fileSize?.toString() },
        uploadUrl,
        // Header da mandare con la PUT su `uploadUrl`, oltre al Content-Type:
        // Azure pretende il tipo di blob, S3 non vuole header in più (ognuno
        // andrebbe ammesso anche nel CORS del bucket).
        uploadHeaders:
          getFilesStorage()?.type === 'azure'
            ? { 'x-ms-blob-type': 'BlockBlob' }
            : {},
      },
      { status: 201 },
    );
  },
);

export const DELETE = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ param: string }> },
  ) => {
    const { param } = await context.params;
    const token = extractModeratorToken(request);
    if (!token) throw new UnauthorizedError();

    const event = await verifyModeratorToken(param, token);
    if (!event) throw new UnauthorizedError();

    const { searchParams } = new URL(request.url);
    const materialId = searchParams.get('materialId');
    if (!materialId) throw new ValidationError('Missing materialId');

    const material = await prisma.eventMaterial.findFirst({
      where: { id: materialId, eventId: event.id, type: 'FILE' },
    });

    if (!material) throw new NotFoundError('Material not found');

    // Stesse regole di ogni altra cancellazione di un materiale
    // (lib/events/material-files): il file solo se è di questo evento e nessun
    // altro lo usa ancora, e prima della riga, che resta se lo storage non
    // risponde.
    const file = await removeMaterialBlob(material.blobPath, event.id, {
      materialIds: [material.id],
    });
    if (file === 'failed') throw fileDeletionFailed();

    await prisma.eventMaterial.delete({ where: { id: materialId } });

    return NextResponse.json({ success: true });
  },
);
