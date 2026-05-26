import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/db';
import { withErrorHandling } from '@/lib/api-handler';
import {
  AppError,
  UnauthorizedError,
  ValidationError,
  NotFoundError,
} from '@/lib/errors';
import { constantTimeEqual } from '@/lib/auth/moderator';
import { verifyWebhookSignature } from '@/lib/auth/webhook-signature';
import { encryptJSON } from '@/lib/crypto/pii';

let warnedSignatureMissing = false;

function logWarningOnce(message: string): void {
  if (warnedSignatureMissing) return;
  warnedSignatureMissing = true;
  console.warn(message);
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  // Read the raw body once: HMAC verification must run on the exact bytes
  // produced by the sender, so we cannot rely on request.json() (which
  // would also consume the stream and prevent re-reading).
  const rawBody = await request.text();

  const cronKey = process.env.CRON_API_KEY;
  const authHeader = request.headers.get('authorization');
  const providedKey = authHeader?.replace('Bearer ', '') ?? '';
  const bearerOk = !!cronKey && constantTimeEqual(providedKey, cronKey);

  const webhookSecret = process.env.RECORDING_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = request.headers.get('x-webhook-signature');
    const sigOk = verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!bearerOk || !sigOk) {
      throw new UnauthorizedError();
    }
  } else {
    // Legacy mode: only the bearer is required. Loud one-shot warning so
    // operators notice the missing defence-in-depth in production logs.
    logWarningOnce(
      '[eventi-dtd] RECORDING_WEBHOOK_SECRET is not set — recording webhook ' +
        'falls back to bearer-only auth. Set this env var (and update the ' +
        'Jibri finalize script) to enforce HMAC signatures.',
    );
    if (!bearerOk) {
      throw new UnauthorizedError();
    }
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new AppError('Invalid JSON body', 400, 'INVALID_BODY');
  }

  const roomName = body.roomName as string | undefined;
  const recordingUrl = body.recordingUrl as string | undefined;
  const filename = (body.filename as string) || null;
  const duration = typeof body.duration === 'number' ? body.duration : null;
  const fileSize = typeof body.fileSize === 'number' ? body.fileSize : null;
  const participants = Array.isArray(body.participants) ? body.participants : [];

  if (!roomName || !recordingUrl) {
    throw new ValidationError('roomName and recordingUrl are required');
  }

  // Cap participants array to avoid unbounded payloads writing into the
  // CallSession row.
  const cappedParticipants = participants.slice(0, 500);
  // Encrypt at rest: the participants array contains names / display
  // identifiers that originate from Jitsi (PII). We stash it as a
  // `{ enc: "<base64ct>" }` wrapper in the existing JSONB column so the
  // dual-read path in tryDecryptJSON keeps legacy plaintext rows
  // readable without a migration. See ADR (encryption at rest) and
  // `tryDecryptJSON` in `@/lib/crypto/pii`.
  const encryptedParticipants = encryptJSON(cappedParticipants);

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
        participants: encryptedParticipants,
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
