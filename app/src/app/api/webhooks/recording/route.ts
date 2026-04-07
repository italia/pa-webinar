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

  if (!roomName || !recordingUrl) {
    throw new ValidationError('roomName and recordingUrl are required');
  }

  const event = await prisma.event.findUnique({
    where: { jitsiRoomName: roomName },
  });

  if (!event) {
    throw new NotFoundError('Event');
  }

  await prisma.event.update({
    where: { id: event.id },
    data: { recordingUrl },
  });

  return Response.json({
    success: true,
    eventId: event.id,
    slug: event.slug,
  });
});
