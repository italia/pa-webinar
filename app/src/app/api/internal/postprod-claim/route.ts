/**
 * POST /api/internal/postprod-claim
 *
 * Worker → app: claim the next runnable PostprodJob.
 *
 * "Runnable" = status=PENDING + next_attempt_at<=NOW + dependency (if
 * any) is DONE. We claim in a single round-trip with `FOR UPDATE SKIP
 * LOCKED` + immediate lease push, mirroring the EmailOutbox pattern
 * (`app/src/app/api/cron/email-outbox/route.ts`).
 *
 * The response is the worker's whole work-order: signed download URL
 * for the source MP4, signed upload URLs for every artifact the kind
 * is expected to produce, and provider hints (which LLM / model to
 * call). Workers never need to do their own presigning or DB writes
 * for ownership-sensitive paths.
 *
 * Auth: CRON_API_KEY (x-api-key). The worker pod gets the secret via
 * envFrom — same Secret as the cron jobs. No HMAC body signature here
 * because the worker is in-cluster only (and the network policy will
 * additionally restrict ingress to the app pod CIDR).
 */

import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { AppError, NotFoundError, ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import {
  artifactMimeType,
  artifactPath,
  expectedArtifactsForJob,
  postprodJobPayloadSchema,
} from '@/lib/ai';
import {
  resolveAsrProvider,
  resolveLlmProvider,
  resolveTtsProvider,
} from '@/lib/ai/providers';
import {
  presignArtifactDownload,
  presignArtifactUpload,
} from '@/lib/storage/postprod';
import { postprodJobAttemptsTotal } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

/**
 * Costruisce l'initial_prompt per WhisperX dai metadata dell'evento.
 * Aiuta Whisper a riconoscere nomi propri, sigle, organizzazioni
 * specifiche dell'evento (es. "PCM", "OVH", "Raffaele Vitiello").
 *
 * Cap a 800 caratteri per stare ben dentro la token-window di Whisper
 * (~224 tokens il modello accetta come prompt iniziale).
 */
function buildAsrInitialPrompt(event: {
  title: unknown;
  organizerName: string | null;
  speakersInfo: unknown;
}): string | undefined {
  const localised = (v: unknown): string | undefined => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      for (const key of ['it', 'en', 'fr', 'de', 'es']) {
        const candidate = obj[key];
        if (typeof candidate === 'string' && candidate.trim()) return candidate;
      }
    }
    return undefined;
  };
  const parts: string[] = [];
  const title = localised(event.title);
  if (title) parts.push(title.trim());
  if (event.organizerName) {
    parts.push(`Organizzato da ${event.organizerName.trim()}.`);
  }
  const speakers = localised(event.speakersInfo);
  if (speakers) parts.push(`Partecipanti e relatori: ${speakers.trim()}.`);
  const out = parts.join(' ').trim();
  if (!out) return undefined;
  return out.length > 800 ? out.slice(0, 800) : out;
}

const claimRequestSchema = z.object({
  /** Worker pod name — recorded as leased_by for observability. */
  workerId: z.string().min(1).max(120),
  /** Lease horizon, in minutes. Default 30, max 120. */
  leaseMinutes: z.number().int().min(1).max(120).optional(),
});

interface ClaimedRow {
  id: string;
  recording_id: string;
  kind: 'TRANSCRIBE' | 'SUMMARIZE' | 'TRANSLATE' | 'SUBTITLE' | 'DUB';
  payload: unknown;
  attempts: number;
  next_attempt_at: Date;
  depends_on_id: string | null;
}

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const body = (await request.json()) as unknown;
  const { workerId, leaseMinutes } = claimRequestSchema.parse(body);
  const lease = leaseMinutes ?? 30;
  const leaseUntil = new Date(Date.now() + lease * 60_000);

  // Atomic claim. Two conditions on the dependency:
  //   - depends_on_id IS NULL, OR
  //   - the depended-on job is DONE
  // We don't lock the parent because we don't update it.
  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    WITH ready AS (
      SELECT j.id
      FROM postprod_jobs j
      LEFT JOIN postprod_jobs dep ON dep.id = j.depends_on_id
      WHERE j.status = 'PENDING'
        AND j.next_attempt_at <= NOW()
        AND (j.depends_on_id IS NULL OR dep.status = 'DONE')
      ORDER BY j.next_attempt_at ASC
      LIMIT 1
      -- Lock ONLY j (the row we claim). Without OF j, Postgres tries to
      -- lock both sides of the LEFT JOIN and rejects locking the
      -- nullable dep side with SQLSTATE 0A000 (FOR UPDATE cannot be
      -- applied to the nullable side of an outer join), which made every
      -- cluster claim 500. We never update dep, so locking it was never
      -- intended.
      FOR UPDATE OF j SKIP LOCKED
    )
    UPDATE postprod_jobs o
    SET status = 'CLAIMED',
        leased_at = NOW(),
        leased_by = ${workerId},
        next_attempt_at = ${leaseUntil},
        attempts = o.attempts + 1,
        updated_at = NOW()
    FROM ready
    WHERE o.id = ready.id
    RETURNING o.id, o.recording_id, o.kind, o.payload, o.attempts,
              o.next_attempt_at, o.depends_on_id
  `;

  if (claimed.length === 0) {
    return Response.json({ claimed: false }, { status: 204 });
  }

  const row = claimed[0]!;
  // Conta ogni claim come "attempt" — il counter cresce monotone ogni
  // volta che un worker riceve un job, indipendentemente dal fatto che
  // poi vada DONE o FAILED. rate(...[5m]) mostra il throughput dei
  // worker attivi.
  postprodJobAttemptsTotal.labels(row.kind).inc();

  // Re-validate the payload at claim time. A malformed row stays
  // CLAIMED with attempts++ — the orchestrator's retry policy will
  // eventually move it to FAILED. Returning a 500 lets the worker
  // simply re-poll on the next loop.
  const parsed = postprodJobPayloadSchema.safeParse({
    kind: row.kind,
    payload: row.payload,
  });
  if (!parsed.success) {
    throw new ValidationError(
      `postprod_job ${row.id} has malformed payload: ${parsed.error.message}`,
    );
  }

  // Fetch Recording + Event for provider routing + source path.
  const recording = await prisma.recording.findUnique({
    where: { id: row.recording_id },
    include: {
      event: {
        select: {
          id: true,
          slug: true,
          aiTargetLocales: true,
          title: true,
          organizerName: true,
          speakersInfo: true,
          expectedSpeakers: true,
        },
      },
    },
  });
  if (!recording) throw new NotFoundError('Recording');

  const siteSettings = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: {
      aiLlmProvider: true,
      aiAsrProvider: true,
      aiTtsEngine: true,
    },
  });

  const llm = resolveLlmProvider({
    siteProvider: siteSettings?.aiLlmProvider ?? 'vllm',
  });
  const asr = resolveAsrProvider({
    siteProvider: siteSettings?.aiAsrProvider ?? 'whisperx',
  });
  const tts = resolveTtsProvider({
    siteProvider: siteSettings?.aiTtsEngine ?? 'piper',
  });

  // Build the upload-targets map: one presigned PUT URL per expected
  // artifact for this job.
  const expected = expectedArtifactsForJob(
    row.kind,
    parsed.data.payload as Record<string, string | undefined>,
  );
  const uploadTargets: Record<
    string,
    { url: string; blobKey: string; contentType: string }
  > = {};
  for (const a of expected) {
    const blobKey = artifactPath(
      {
        eventId: recording.eventId,
        recordingId: recording.id,
        runCount: recording.runCount,
      },
      a.type,
      a.language,
    );
    const contentType = artifactMimeType(a.type);
    const { uploadUrl } = await presignArtifactUpload({
      blobKey,
      contentType,
      expiresInMinutes: lease,
    });
    uploadTargets[a.role] = { url: uploadUrl, blobKey, contentType };
  }

  // Waveform peaks are an OPTIONAL extra output of TRANSCRIBE — handed
  // to the worker as an upload target but deliberately kept OUT of
  // `expectedArtifactsForJob` so the job's DONE accounting (which keys
  // off the expected count) is unaffected. This decouples app/worker
  // rollouts: an old worker that ignores this target still completes
  // the job, and a new worker just registers a bonus WAVEFORM_JSON
  // artifact. The admin transcript editor uses it to draw a waveform
  // without downloading the source MP4.
  if (row.kind === 'TRANSCRIBE') {
    const waveformKey = artifactPath(
      {
        eventId: recording.eventId,
        recordingId: recording.id,
        runCount: recording.runCount,
      },
      'WAVEFORM_JSON',
      null,
    );
    const waveformMime = artifactMimeType('WAVEFORM_JSON');
    const presigned = await presignArtifactUpload({
      blobKey: waveformKey,
      contentType: waveformMime,
      expiresInMinutes: lease,
    });
    uploadTargets.waveform = {
      url: presigned.uploadUrl,
      blobKey: waveformKey,
      contentType: waveformMime,
    };
  }

  // Inputs: dependency artifacts the worker needs to read. For now
  // SUMMARIZE/TRANSLATE need the transcript raw JSON produced by
  // TRANSCRIBE (which is recorded as TRANSCRIPT_JSON). We look it up
  // by (recordingId, type, language=NULL).
  const inputs: Array<{ role: string; downloadUrl: string; blobKey: string }> = [];
  const sourceDownloadUrl = await presignArtifactDownload({
    blobKey: recording.blobKey,
    expiresInMinutes: lease,
  });

  if (row.kind === 'SUMMARIZE' || row.kind === 'TRANSLATE' || row.kind === 'DUB') {
    // Prisma's findUnique on a composite key with a nullable column
    // can't match NULL via the generated input type (NULL is treated
    // as "distinct" in SQL but not as a value in TypeScript), so we
    // use findFirst with the equality semantics we need.
    const transcript = await prisma.postprodArtifact.findFirst({
      where: {
        recordingId: recording.id,
        type: 'TRANSCRIPT_JSON',
        language: null,
      },
      select: { blobKey: true },
    });
    if (!transcript) {
      // Defensive: dependency check above should have prevented this.
      throw new AppError(
        `claim ${row.id}: transcript missing despite DONE dependency`,
        500,
        'POSTPROD_INCONSISTENT_DEPS',
      );
    }
    const url = await presignArtifactDownload({
      blobKey: transcript.blobKey,
      expiresInMinutes: lease,
    });
    inputs.push({
      role: 'transcript',
      downloadUrl: url,
      blobKey: transcript.blobKey,
    });

    // DUB richiede ANCHE il TRANSLATION_VTT della lingua target —
    // contiene i segmenti tradotti con timestamp originali su cui
    // il TTS allinea l'audio generato.
    if (row.kind === 'DUB') {
      const targetLang = (parsed.data.payload as { targetLanguage?: string })
        .targetLanguage;
      if (!targetLang) {
        throw new AppError('DUB payload missing targetLanguage', 400, 'POSTPROD_BAD_PAYLOAD');
      }
      const translation = await prisma.postprodArtifact.findFirst({
        where: {
          recordingId: recording.id,
          type: 'TRANSLATION_VTT',
          language: targetLang,
        },
        select: { blobKey: true },
      });
      if (!translation) {
        throw new AppError(
          `DUB claim ${row.id}: TRANSLATION_VTT for ${targetLang} missing despite DONE dep`,
          500,
          'POSTPROD_INCONSISTENT_DEPS',
        );
      }
      const tUrl = await presignArtifactDownload({
        blobKey: translation.blobKey,
        expiresInMinutes: lease,
      });
      inputs.push({
        role: 'translatedTranscript',
        downloadUrl: tUrl,
        blobKey: translation.blobKey,
      });
    }
  }

  return Response.json(
    {
      claimed: true,
      jobId: row.id,
      recordingId: row.recording_id,
      kind: row.kind,
      payload: parsed.data.payload,
      attempts: row.attempts,
      leaseExpiresAt: leaseUntil.toISOString(),
      sourceDownloadUrl,
      uploadTargets,
      inputs,
      providerHints: {
        llmProvider: llm.provider,
        asrProvider: asr.provider,
        ttsProvider: tts.engine,
        llmBaseUrl: llm.baseUrl,
        llmModelId: llm.modelId,
        asrModelId: asr.modelId,
        ttsVoicesPath: tts.voicesPath,
        // Context-aware quality knobs (TRANSCRIBE job).
        // - initial_prompt: nomi propri + termini specifici dell'evento.
        // - expectedSpeakers: forza k nella diarization se admin lo sa.
        ...(row.kind === 'TRANSCRIBE'
          ? {
              asrInitialPrompt: buildAsrInitialPrompt(recording.event),
              expectedSpeakers: recording.event.expectedSpeakers ?? undefined,
            }
          : {}),
      },
    },
    { status: 200 },
  );
});
