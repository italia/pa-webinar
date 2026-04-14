import { withErrorHandling } from '@/lib/api-handler';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { extractModeratorToken, constantTimeEqual } from '@/lib/auth/moderator';
import { isAzureConfigured, deleteBlob } from '@/lib/azure/blob-storage';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (request, context) => {
  const { param, id } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Moderator token required');

  const isUuid = UUID_RE.test(param);
  const event = await prisma.event.findFirst({
    where: {
      ...(isUuid ? { OR: [{ id: param }, { slug: param }] } : { slug: param }),
      moderatorToken: token,
    },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const session = await prisma.callSession.findFirst({
    where: { id, eventId: event.id },
  });
  if (!session) throw new NotFoundError('CallSession');

  return Response.json({
    id: session.id,
    jitsiRoomName: session.jitsiRoomName,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    duration: session.duration,
    peakParticipants: session.peakParticipants,
    participants: session.participants,
    recordingUrl: session.recordingUrl,
    recordingFileSize: session.recordingFileSize ? Number(session.recordingFileSize) : null,
    recordingDuration: session.recordingDuration,
    recordingFilename: session.recordingFilename,
    telemetry: session.telemetry,
    createdAt: session.createdAt.toISOString(),
  });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param, id } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Moderator token required');

  const isUuid = UUID_RE.test(param);
  const event = await prisma.event.findFirst({
    where: {
      ...(isUuid ? { OR: [{ id: param }, { slug: param }] } : { slug: param }),
      moderatorToken: token,
    },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const session = await prisma.callSession.findFirst({
    where: { id, eventId: event.id },
    select: { id: true, recordingUrl: true },
  });
  if (!session) throw new NotFoundError('CallSession');

  if (session.recordingUrl && isAzureConfigured()) {
    try {
      await deleteBlob(`recordings/${id}`);
    } catch { /* best effort */ }
  }

  await prisma.callSession.delete({ where: { id: session.id } });

  return Response.json({ deleted: true });
});
