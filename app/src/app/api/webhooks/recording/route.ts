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
import { enqueuePostprodForRecording } from '@/lib/ai/enqueue';
import { MULTITRACK_PREFIX } from '@/lib/recorder/lifecycle';

let warnedSignatureMissing = false;

function logWarningOnce(message: string): void {
  if (warnedSignatureMissing) return;
  warnedSignatureMissing = true;
  console.warn(message);
}

/**
 * Deriva la blobKey del mix Jibri. Jibri carica sotto `recordings/`
 * (vedi jibri-finalize.sh); la StorageProvider lavora su key nude, non URL.
 */
function deriveMixBlobKey(filename: string | null, recordingUrl: string): string {
  if (filename) return `recordings/${filename}`;
  try {
    const u = new URL(recordingUrl);
    const path = u.pathname.split('/').filter(Boolean);
    // Path-style: /<bucket>/<...key>; virtual-hosted: /<...key>
    return path.length > 1 ? path.slice(1).join('/') : path.join('/');
  } catch {
    return recordingUrl;
  }
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
      aiTranscriptEnabled: true,
    },
  });

  if (!event) {
    throw new NotFoundError('Event');
  }

  // Wrapped in a callback transaction so we can both:
  //   - run the existing Event/CallSession writes,
  //   - create the Recording row,
  //   - enqueue postprod jobs (which themselves do dependent SELECTs)
  // atomically. A throw rolls everything back. The callback form (vs
  // an array of operations) is required because enqueuePostprodForRecording
  // needs to read the recording row it just inserted.
  const result = await prisma.$transaction(async (tx) => {
    const updatedEvent = await tx.event.update({
      where: { id: event.id },
      data: {
        recordingUrl,
        recordingDuration: duration,
        recordingFileSize: fileSize ? BigInt(fileSize) : null,
      },
    });

    const mixBlobKey = deriveMixBlobKey(filename, recordingUrl);

    // ADR-013 Fase 3 (lifecycle unificato): se per questo evento esiste già
    // una Recording multi-traccia (segnaposto creato al dispatch del
    // recorder), arricchiscila col mix Jibri invece di crearne una seconda.
    // Questo branch scatta SOLO per eventi multi-traccia → i flussi
    // single-track restano identici. Nessun enqueue qui: la pipeline
    // multitraccia parte dall'ingest delle tracce (`multitrack-manifest`).
    const placeholder = await tx.recording.findFirst({
      where: { eventId: event.id, blobKey: { startsWith: MULTITRACK_PREFIX } },
      select: { id: true, callSessionId: true },
    });
    if (placeholder) {
      await tx.callSession.update({
        where: { id: placeholder.callSessionId },
        data: {
          endedAt: new Date(),
          duration,
          peakParticipants: event.peakParticipants,
          participants: encryptedParticipants,
          recordingUrl,
          recordingFileSize: fileSize ? BigInt(fileSize) : null,
          recordingDuration: duration,
          recordingFilename: filename,
        },
      });
      const recording = await tx.recording.update({
        where: { id: placeholder.id },
        data: {
          blobKey: mixBlobKey,
          durationSec: duration,
          fileSizeBytes: fileSize ? BigInt(fileSize) : null,
        },
        select: { id: true },
      });
      return {
        updatedEvent,
        callSession: { id: placeholder.callSessionId },
        recording,
        postprod: { enqueued: 0, skippedExisting: 0, jobIds: [] as string[] },
      };
    }

    const callSession = await tx.callSession.create({
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
    });

    // Recording row exists 1:1 with CallSession.
    const recording = await tx.recording.create({
      data: {
        callSessionId: callSession.id,
        eventId: event.id,
        blobKey: mixBlobKey,
        durationSec: duration,
        fileSizeBytes: fileSize ? BigInt(fileSize) : null,
      },
      select: { id: true },
    });

    let postprod = { enqueued: 0, skippedExisting: 0, jobIds: [] as string[] };
    if (event.aiTranscriptEnabled) {
      postprod = await enqueuePostprodForRecording(tx, {
        recordingId: recording.id,
      });
    }

    return {
      updatedEvent,
      callSession,
      recording,
      postprod,
    };
  });

  return Response.json({
    success: true,
    eventId: result.updatedEvent.id,
    slug: event.slug,
    sessionId: result.callSession.id,
    recordingId: result.recording.id,
    postprodEnqueued: result.postprod.enqueued,
    postprodJobIds: result.postprod.jobIds,
  });
});
