/**
 * POST /api/internal/multitrack-manifest  (ADR-013, Fase 2)
 *
 * Il multitrack-recorder (infra/recorder), a fine evento, ha caricato N
 * tracce audio per-partecipante in object storage e chiama questo
 * endpoint col manifest. Il portale:
 *   1. crea/aggiorna le righe `RecordingTrack` (cifrando il displayName,
 *      che nel manifest arriva in chiaro — il recorder non ha le chiavi
 *      PII; vedi ADR-013);
 *   2. accoda la pipeline con job radice TRANSCRIBE_MULTITRACK.
 *
 * Auth: CRON_API_KEY (in-cluster, come gli altri endpoint /internal).
 *
 * Difensivo: i blobKey delle tracce devono stare sotto il prefisso
 * `recordings/multitrack/{eventId}/{recordingId}/` così un recorder
 * compromesso non può puntare a blob arbitrari.
 */

import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { encryptPIIOrNull } from '@/lib/crypto/pii';
import { enqueuePostprodForRecording } from '@/lib/ai/enqueue';
import { allTracksSilent, SILENCE_FLOOR_BYTES_PER_SEC } from '@/lib/ai/track-silence';

export const dynamic = 'force-dynamic';

const trackSchema = z.object({
  participantId: z.string().min(1).max(200),
  displayName: z.string().max(200).nullable().optional(),
  blobKey: z.string().min(1).max(1_024),
  mimeType: z.string().min(1).max(120).default('audio/ogg'),
  sizeBytes: z.number().int().min(0).optional(),
  startOffsetMs: z.number().int().min(0).default(0),
  durationMs: z.number().int().min(0).optional(),
});

const bodySchema = z.object({
  eventId: z.string().uuid(),
  recordingId: z.string().uuid(),
  tracks: z.array(trackSchema).min(1).max(500),
});

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const { eventId, recordingId, tracks } = bodySchema.parse(await request.json());

  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: {
      id: true,
      eventId: true,
      event: { select: { aiTranscriptEnabled: true } },
    },
  });
  if (!recording) throw new NotFoundError('Recording');
  if (recording.eventId !== eventId) {
    throw new ValidationError('eventId does not match the recording');
  }

  // Path-confinement: ogni traccia deve vivere sotto il prefisso atteso.
  const prefix = `recordings/multitrack/${eventId}/${recordingId}/`;
  for (const t of tracks) {
    if (!t.blobKey.startsWith(prefix)) {
      throw new ValidationError(
        `track blobKey "${t.blobKey}" outside expected prefix "${prefix}"`,
      );
    }
  }

  // Silence guard (ADR-013 defense-in-depth): if the recorder captured only
  // digital silence on EVERY track — the pre-9739d70 Chrome-headless failure —
  // a TRANSCRIBE_MULTITRACK would burn GPU and yield empty transcripts that
  // masquerade as "done". We only act when the AI pipeline would actually run
  // (enqueue is already a no-op when the event has AI transcription off), and
  // we mark the recording POSTPROD_FAILED so the failure is VISIBLE in the
  // admin recordings views and re-runnable via "Genera AI" — rather than
  // silently stuck at READY. Gates on ALL tracks and fails open (see
  // allTracksSilent), so a genuinely-recorded event is never blocked.
  const skipSilent = allTracksSilent(tracks) && recording.event.aiTranscriptEnabled;

  const result = await prisma.$transaction(async (tx) => {
    for (const t of tracks) {
      const data = {
        participantId: t.participantId,
        displayName: encryptPIIOrNull(t.displayName ?? null),
        mimeType: t.mimeType,
        sizeBytes: t.sizeBytes != null ? BigInt(t.sizeBytes) : null,
        startOffsetMs: t.startOffsetMs,
        durationMs: t.durationMs ?? null,
      };
      // upsert su (recordingId, blobKey): blobKey è univoco PER SESSIONE
      // (include il trackFileId), quindi un rejoin dello stesso pid crea una
      // riga distinta invece di sovrascrivere. Idempotente sul retry del
      // webhook (stesso blobKey → update).
      await tx.recordingTrack.upsert({
        where: {
          recordingId_blobKey: {
            recordingId,
            blobKey: t.blobKey,
          },
        },
        create: { recordingId, blobKey: t.blobKey, ...data },
        update: data,
      });
    }

    if (skipSilent) {
      // Mark the recording failed (visible + admin-retryable) instead of
      // enqueuing a doomed pipeline; the loud log below is the operator signal.
      await tx.recording.update({
        where: { id: recordingId },
        data: { status: 'POSTPROD_FAILED' },
      });
      return { enqueued: 0, skippedExisting: 0, jobIds: [] };
    }

    // Accoda la pipeline multi-traccia (idempotente via idempotency_key).
    return enqueuePostprodForRecording(tx, { recordingId, multitrack: true });
  });

  if (skipSilent) {
    console.error(
      `[multitrack-manifest] recording=${recordingId} event=${eventId}: all ${tracks.length} ` +
        `track(s) at/under the ${SILENCE_FLOOR_BYTES_PER_SEC} B/s silence floor — captured audio is ` +
        `empty (likely a stale/broken recorder image, cf. recorder commit 9739d70). ` +
        `Marked POSTPROD_FAILED and skipped TRANSCRIBE_MULTITRACK; use the admin "Genera AI" ` +
        `control to force a re-run if this is wrong.`,
    );
  }

  return Response.json({
    ok: true,
    tracks: tracks.length,
    enqueued: result.enqueued,
    skipped: result.skippedExisting,
    silent: skipSilent,
  });
});
