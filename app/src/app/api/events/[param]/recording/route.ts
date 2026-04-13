import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import {
  extractModeratorToken,
  constantTimeEqual,
} from '@/lib/auth/moderator';
import {
  isAzureConfigured,
  deleteBlob,
  getRecordingBlobPath,
} from '@/lib/azure/blob-storage';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (_request, context) => {
  const { param } = await context.params;
  const isUuid = UUID_RE.test(param);

  const event = await prisma.event.findFirst({
    where: isUuid
      ? { OR: [{ id: param }, { slug: param }] }
      : { slug: param },
    select: { recordingUrl: true, status: true, recordingPublished: true },
  });

  if (!event?.recordingUrl) throw new NotFoundError('Recording');
  if (event.status !== 'ENDED' && event.status !== 'ARCHIVED') {
    throw new ForbiddenError('Recording not yet available');
  }
  if (!event.recordingPublished) {
    throw new ForbiddenError('Recording not published');
  }

  return Response.redirect(event.recordingUrl, 302);
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const isUuid = UUID_RE.test(param);

  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Moderator token required');

  const event = await prisma.event.findFirst({
    where: isUuid
      ? { OR: [{ id: param }, { slug: param }] }
      : { slug: param },
    select: {
      id: true,
      moderatorToken: true,
      recordingUrl: true,
      tempRecordingUrl: true,
    },
  });

  if (!event) throw new NotFoundError('Event');
  if (!constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Invalid moderator token');
  }

  if (isAzureConfigured() && (event.recordingUrl || event.tempRecordingUrl)) {
    const blobPath = getRecordingBlobPath(event.id);
    await deleteBlob(blobPath);
  }

  await prisma.$transaction([
    prisma.event.update({
      where: { id: event.id },
      data: {
        recordingUrl: null,
        tempRecordingUrl: null,
        tempRecordingStartedAt: null,
        recordingPublished: false,
        recordingPublishedAt: null,
        recordingFileSize: null,
        recordingDuration: null,
        recordingDeleteAfterDays: null,
      },
    }),
    prisma.gdprAuditLog.create({
      data: {
        eventId: event.id,
        action: 'RECORDING_DELETED',
        recordCount: 1,
        details: JSON.stringify({
          hadRecordingUrl: !!event.recordingUrl,
          hadTempRecordingUrl: !!event.tempRecordingUrl,
        }),
      },
    }),
  ]);

  return Response.json({ deleted: true });
});
