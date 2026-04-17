import { withErrorHandling } from '@/lib/api-handler';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { extractModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
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

  const sessions = await prisma.callSession.findMany({
    where: { eventId: event.id },
    orderBy: { startedAt: 'desc' },
  });

  return Response.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      jitsiRoomName: s.jitsiRoomName,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      duration: s.duration,
      peakParticipants: s.peakParticipants,
      participants: s.participants,
      recordingUrl: s.recordingUrl,
      recordingFileSize: s.recordingFileSize ? Number(s.recordingFileSize) : null,
      recordingDuration: s.recordingDuration,
      recordingFilename: s.recordingFilename,
      telemetry: s.telemetry,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});
