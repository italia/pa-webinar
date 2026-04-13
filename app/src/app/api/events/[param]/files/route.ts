import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import {
  extractModeratorToken,
  verifyModeratorToken,
} from '@/lib/auth/moderator';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, ValidationError, NotFoundError } from '@/lib/errors';
import {
  isAzureConfigured,
  generateUploadSasUrl,
  deleteBlob,
  getBlobPath,
  ensureContainer,
} from '@/lib/azure/blob-storage';

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
    _request: NextRequest,
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
      select: { id: true },
    });

    if (!event) throw new NotFoundError('Event not found');

    const materials = await prisma.eventMaterial.findMany({
      where: { eventId: event.id, type: 'FILE' },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(materials);
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

    if (material.blobPath && isAzureConfigured()) {
      await deleteBlob(material.blobPath);
    }

    await prisma.eventMaterial.delete({ where: { id: materialId } });

    return NextResponse.json({ success: true });
  },
);
