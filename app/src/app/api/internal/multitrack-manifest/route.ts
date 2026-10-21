/**
 * POST /api/internal/multitrack-manifest  (ADR-013, Fase 2)
 *
 * Il multitrack-recorder (infra/recorder), a fine evento, ha caricato N
 * tracce audio per-partecipante in object storage e chiama questo
 * endpoint col manifest. Il portale:
 *   1. crea/aggiorna le righe `RecordingTrack` (cifrando il displayName,
 *      che nel manifest arriva in chiaro — il recorder non ha le chiavi
 *      PII; vedi ADR-013), tutte sullo stesso zero anche quando arrivano da
 *      piu' esecuzioni del recorder (lib/recorder/track-zero);
 *   2. accoda la pipeline con job radice TRANSCRIBE_MULTITRACK. Non se il
 *      recorder e' stato fermato a diretta ancora in corso: un'altra
 *      esecuzione registra il resto e la accoda lei, con tutte le tracce.
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
import { multitrackRecordingPrefix } from '@/lib/recorder/lifecycle';
import { unisciZero } from '@/lib/recorder/track-zero';

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
  /** Ora assoluta (epoch ms, orologio del registratore) del primo fotogramma:
   *  lo zero dei tempi delle tracce e della trascrizione. Facoltativa per i
   *  registratori che non la mandano ancora; un valore senza senso si ignora
   *  invece di rifiutare il manifest, che porterebbe via le tracce. */
  recordingStartedAtMs: z.number().optional(),
  /** Cattura fermata dall'esterno (arresto del pod) prima della fine. */
  interrupted: z.boolean().optional(),
});

/** Dal 2020 in poi: prima e' un valore rotto, non un'ora di registrazione. */
const MIN_PLAUSIBLE_EPOCH_MS = Date.UTC(2020, 0, 1);

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const { eventId, recordingId, tracks, recordingStartedAtMs, interrupted } = bodySchema.parse(
    await request.json(),
  );

  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: {
      id: true,
      eventId: true,
      event: { select: { aiTranscriptEnabled: true, status: true } },
    },
  });
  if (!recording) throw new NotFoundError('Recording');
  if (recording.eventId !== eventId) {
    throw new ValidationError('eventId does not match the recording');
  }

  // Path-confinement: ogni traccia deve vivere sotto il prefisso atteso.
  const prefix = multitrackRecordingPrefix(eventId, recordingId);
  for (const t of tracks) {
    if (!t.blobKey.startsWith(prefix)) {
      throw new ValidationError(
        `track blobKey "${t.blobKey}" outside expected prefix "${prefix}"`,
      );
    }
  }

  // Silence guard (ADR-013 defense-in-depth): if the recorder captured only
  // digital silence on EVERY track — the Chrome-headless capture failure that
  // predates the recorder's virtual-sink fix —
  // a TRANSCRIBE_MULTITRACK would burn GPU and yield empty transcripts that
  // masquerade as "done". We only act when the AI pipeline would actually run
  // (enqueue is already a no-op when the event has AI transcription off), and
  // we mark the recording POSTPROD_FAILED so the failure is VISIBLE in the
  // admin recordings views and re-runnable via "Genera AI" — rather than
  // silently stuck at READY. Gates on ALL tracks and fails open (see
  // allTracksSilent), so a genuinely-recorded event is never blocked.
  // Una parte dell'evento, con l'evento ancora aperto (anche in pausa o in
  // allestimento): le tracce si tengono, la pipeline la accoda l'esecuzione
  // che arriva in fondo.
  const parziale =
    interrupted === true &&
    recording.event.status !== 'ENDED' &&
    recording.event.status !== 'ARCHIVED';

  let skipSilent = false;
  const result = await prisma.$transaction(async (tx) => {
    // Due manifest della stessa registrazione non si mescolano a meta'.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`multitrack-manifest:${recordingId}`}))`;
    // Lo zero dei tempi della trascrizione: la cronologia della sala ci
    // misura sopra le sue azioni (lib/postprod/live-timeline.ts).
    let spostaNuoveMs = 0;
    if (
      recordingStartedAtMs !== undefined &&
      Number.isFinite(recordingStartedAtMs) &&
      recordingStartedAtMs >= MIN_PLAUSIBLE_EPOCH_MS
    ) {
      const prima = await tx.recording.findUnique({
        where: { id: recordingId },
        select: { mediaStartedAt: true },
      });
      // Le tracce di un'altra esecuzione: quelle di questo manifest, se e'
      // un nuovo invio dello stesso, hanno gia' lo zero giusto.
      const altre = await tx.recordingTrack.count({
        where: { recordingId, blobKey: { notIn: tracks.map((t) => t.blobKey) } },
      });
      const unito = unisciZero({
        esistente: prima?.mediaStartedAt ?? null,
        conTracce: altre > 0,
        arrivoMs: recordingStartedAtMs,
      });
      if (unito.spostaEsistentiMs > 0) {
        await tx.recordingTrack.updateMany({
          where: { recordingId },
          data: { startOffsetMs: { increment: unito.spostaEsistentiMs } },
        });
      }
      spostaNuoveMs = unito.spostaNuoveMs;
      await tx.recording.update({
        where: { id: recordingId },
        data: { mediaStartedAt: unito.zero },
      });
    }
    for (const t of tracks) {
      const data = {
        participantId: t.participantId,
        displayName: encryptPIIOrNull(t.displayName ?? null),
        mimeType: t.mimeType,
        sizeBytes: t.sizeBytes != null ? BigInt(t.sizeBytes) : null,
        startOffsetMs: t.startOffsetMs + spostaNuoveMs,
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

    if (parziale) return { enqueued: 0, skippedExisting: 0, jobIds: [] };
    // Il silenzio si giudica su tutte le tracce della registrazione, anche
    // quelle di un'esecuzione precedente: una seconda esecuzione breve e
    // silenziosa non deve buttare l'audio della prima.
    if (recording.event.aiTranscriptEnabled) {
      const tutte = await tx.recordingTrack.findMany({
        where: { recordingId },
        select: { sizeBytes: true, durationMs: true },
      });
      skipSilent = allTracksSilent(
        tutte.map((t) => ({
          sizeBytes: t.sizeBytes != null ? Number(t.sizeBytes) : null,
          durationMs: t.durationMs,
        })),
      );
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
        `empty (likely a stale/broken recorder image). ` +
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
    partial: parziale,
  });
});
