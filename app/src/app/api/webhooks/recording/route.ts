import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/db';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, ValidationError, NotFoundError } from '@/lib/errors';
import { constantTimeEqual } from '@/lib/auth/moderator';

export const POST = withErrorHandling(async (request: NextRequest) => {
  const cronKey = process.env.CRON_API_KEY;
  const authHeader = request.headers.get('authorization');
  const providedKey = authHeader?.replace('Bearer ', '') ?? '';

  if (!cronKey || !constantTimeEqual(providedKey, cronKey)) {
    throw new UnauthorizedError();
  }

  const body = (await parseJsonBody(request)) as Record<string, unknown>;
  const roomName = body.roomName as string | undefined;
  const recordingUrl = body.recordingUrl as string | undefined;
  const filename = (body.filename as string) || null;
  const duration = typeof body.duration === 'number' ? body.duration : null;
  const fileSize = typeof body.fileSize === 'number' ? body.fileSize : null;
  const participants = Array.isArray(body.participants) ? body.participants : [];

  if (!roomName || !recordingUrl) {
    throw new ValidationError('roomName and recordingUrl are required');
  }

  const event = await prisma.event.findUnique({
    where: { jitsiRoomName: roomName },
    select: {
      id: true,
      slug: true,
      startsAt: true,
      peakParticipants: true,
    },
  });

  if (!event) {
    throw new NotFoundError('Event');
  }

  const [updatedEvent, callSession] = await prisma.$transaction([
    prisma.event.update({
      where: { id: event.id },
      data: {
        recordingUrl,
        recordingDuration: duration,
        recordingFileSize: fileSize ? BigInt(fileSize) : null,
      },
    }),
    prisma.callSession.create({
      data: {
        eventId: event.id,
        jitsiRoomName: roomName,
        startedAt: event.startsAt,
        endedAt: new Date(),
        duration,
        peakParticipants: event.peakParticipants,
        participants: participants as object[],
        recordingUrl,
        recordingFileSize: fileSize ? BigInt(fileSize) : null,
        recordingDuration: duration,
        recordingFilename: filename,
        telemetry: {},
      },
    }),
  ]);

  return Response.json({
    success: true,
    eventId: updatedEvent.id,
    slug: event.slug,
    sessionId: callSession.id,
  });
});
