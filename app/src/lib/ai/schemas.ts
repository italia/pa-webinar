/**
 * Zod schemas for the postprod pipeline.
 *
 * Two surfaces meet here:
 *
 *   1. **Enqueue / claim payload schemas** — validated when a webhook
 *      creates a PostprodJob and re-validated when the orchestrator
 *      hands the row to a worker. Each `PostprodJobKind` has its own
 *      payload shape so type narrowing works.
 *
 *   2. **Worker → app callback schemas** — `progressPayloadSchema`,
 *      `artifactRegisterSchema`, `claimResponseSchema`. The worker is
 *      a Python container that POSTs JSON; we validate every message
 *      with these schemas before touching the DB.
 *
 * The schemas live in their own module (no Prisma imports!) so they
 * can be safely re-exported from `app/src/lib/ai/index.ts` and used
 * by both the API routes and unit tests.
 */

import { z } from 'zod';

// ── Common primitives ────────────────────────────────────────────

/**
 * ISO-639-1 (2 letters) plus a small allowlist of legacy 3-letter
 * codes we may see flow in from WhisperX language detection. We don't
 * try to be exhaustive — the worker is the source of truth and we
 * only need to refuse obvious garbage.
 */
export const languageCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2,3}(-[a-z]{2,4})?$/i, 'invalid language code');

export const uuidSchema = z.string().uuid();

// ── PostprodJob payloads (one per kind) ──────────────────────────

export const transcribePayloadSchema = z.object({
  runId: uuidSchema,
  sourceLanguage: languageCodeSchema.optional(),
  /**
   * ASR model identifier. Workers may ignore unknown values and fall
   * back to their compile-time default. Tracked here so we can pin a
   * model per-event for reproducibility.
   */
  model: z.string().min(1).max(120).optional(),
  /** WhisperX initial_prompt — improves named entity recall. */
  initialPrompt: z.string().max(2_000).optional(),
});

export const summarizePayloadSchema = z.object({
  runId: uuidSchema,
  sourceLanguage: languageCodeSchema,
  transcriptArtifactId: uuidSchema,
  /** LLM model id. Null = provider default. */
  model: z.string().min(1).max(120).optional(),
});

export const translatePayloadSchema = z.object({
  runId: uuidSchema,
  sourceLanguage: languageCodeSchema,
  targetLanguage: languageCodeSchema,
  transcriptArtifactId: uuidSchema,
  /** When set, the translator also produces a translated SUMMARY_MD. */
  summaryArtifactId: uuidSchema.optional(),
  model: z.string().min(1).max(120).optional(),
});

export const subtitlePayloadSchema = z.object({
  runId: uuidSchema,
  language: languageCodeSchema,
  transcriptArtifactId: uuidSchema,
});

/**
 * Payload per DUB (TTS neutro nelle lingue target).
 *
 *   - `sourceLanguage`: ISO della lingua sorgente, serve al worker per
 *     non perdere lo speaker layout originale.
 *   - `targetLanguage`: ISO della lingua target — il TTS genera audio
 *     in questa lingua usando il transcript tradotto come testo.
 *   - `translatedTranscriptArtifactId`: punta al TRANSLATION_VTT/JSON
 *     prodotto da TRANSLATE → contiene segmenti con start/end aligned
 *     al video originale.
 *   - `engine`: opzionale, override del default site `aiTtsEngine`.
 *     Le scelte sono limitate dal worker (Piper IT/EN/FR/DE/ES).
 */
export const dubPayloadSchema = z.object({
  runId: uuidSchema,
  sourceLanguage: languageCodeSchema,
  targetLanguage: languageCodeSchema,
  translatedTranscriptArtifactId: uuidSchema,
  engine: z.string().min(1).max(40).optional(),
});

/**
 * Discriminated union over all known kinds. Use it to validate a row
 * before handing it to a worker:
 *
 *   const parsed = postprodJobPayloadSchema.parse({ kind: row.kind, ...row.payload })
 */
export const postprodJobPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TRANSCRIBE'), payload: transcribePayloadSchema }),
  // ADR-013: stesso payload di TRANSCRIBE (runId, sourceLanguage, model?).
  // Le tracce per-partecipante arrivano al worker come `inputs` nel claim,
  // non nel payload.
  z.object({ kind: z.literal('TRANSCRIBE_MULTITRACK'), payload: transcribePayloadSchema }),
  z.object({ kind: z.literal('SUMMARIZE'), payload: summarizePayloadSchema }),
  z.object({ kind: z.literal('TRANSLATE'), payload: translatePayloadSchema }),
  z.object({ kind: z.literal('SUBTITLE'), payload: subtitlePayloadSchema }),
  z.object({ kind: z.literal('DUB'), payload: dubPayloadSchema }),
]);

export type PostprodJobPayload = z.infer<typeof postprodJobPayloadSchema>;

// ── Worker → app callbacks ───────────────────────────────────────

/**
 * Claim response — what the worker receives when it pulls a job. The
 * presigned URLs let it download the source recording and upload
 * artifacts without round-tripping body bytes through the Next.js app.
 */
export const claimResponseSchema = z.object({
  jobId: uuidSchema,
  recordingId: uuidSchema,
  kind: z.enum(['TRANSCRIBE', 'TRANSCRIBE_MULTITRACK', 'SUMMARIZE', 'TRANSLATE', 'SUBTITLE', 'DUB']),
  payload: z.unknown(), // narrowed via postprodJobPayloadSchema downstream
  attempts: z.number().int().min(0),
  leaseExpiresAt: z.string().datetime(),
  /**
   * Presigned GET URL for the source MP4. Always returned (even for
   * non-TRANSCRIBE kinds) so workers can re-derive metadata if needed.
   */
  sourceDownloadUrl: z.string().url(),
  /**
   * Map of artifact-key → presigned PUT URL the worker should use to
   * upload outputs. Keyed by a stable string per `kind` so the worker
   * doesn't need to invent paths.
   */
  uploadTargets: z.record(
    z.string(),
    z.object({
      url: z.string().url(),
      blobKey: z.string(),
      contentType: z.string(),
    }),
  ),
  /**
   * Dependency artifacts the worker may need to read (e.g. SUMMARIZE
   * reads the transcript JSON produced by TRANSCRIBE). Empty when no
   * deps.
   */
  inputs: z.array(
    z.object({
      role: z.string(), // "transcript" | "summary" | "track" | ...
      downloadUrl: z.string().url(),
      blobKey: z.string(),
      // ADR-013: presenti solo per role="track" (TRANSCRIBE_MULTITRACK).
      // Identità certa del parlante + offset per il merge su timeline.
      participantId: z.string().optional(),
      displayName: z.string().nullable().optional(),
      startOffsetMs: z.number().int().optional(),
    }),
  ),
  /**
   * Bag of provider-routing hints. All providers must be in-cluster
   * (data sovereignty constraint — see `lib/ai/providers.ts`).
   */
  providerHints: z.object({
    llmProvider: z.enum(['vllm']).default('vllm'),
    asrProvider: z.enum(['whisperx']).default('whisperx'),
    ttsProvider: z.enum(['piper']).default('piper'),
    /**
     * Cluster-internal base URL (e.g. http://pa-webinar-vllm:8000/v1).
     * Refuse to set if the worker network policy doesn't permit egress
     * to this destination.
     */
    llmBaseUrl: z.string().url().optional(),
    llmModelId: z.string().optional(),
    asrModelId: z.string().optional(),
    /** Path locale nel container worker dove sono le voci Piper .onnx. */
    ttsVoicesPath: z.string().optional(),
  }),
});

export type ClaimResponse = z.infer<typeof claimResponseSchema>;

/**
 * Progress push — workers report intermediate status so the admin UI
 * doesn't render "stuck on PENDING" for long-running jobs. We accept
 * a generic shape and store it as JSON; no shape policy beyond size.
 */
export const progressPayloadSchema = z.object({
  jobId: uuidSchema,
  status: z.enum(['RUNNING', 'DONE', 'FAILED']),
  /** 0-100. */
  percent: z.number().min(0).max(100).optional(),
  /** Free-form short message (a stage label, e.g. "diarization"). */
  message: z.string().max(500).optional(),
  /** When status=FAILED, the error reason (stored as last_error). */
  error: z.string().max(2_000).optional(),
});

export type ProgressPayload = z.infer<typeof progressPayloadSchema>;

/**
 * Artifact register — the worker uploaded a blob and now tells the
 * app what to record. `blobKey` must match one of the keys that the
 * claim response handed out (defence in depth: a worker can't write
 * arbitrary keys, and we re-check ownership in the route).
 */
export const artifactRegisterSchema = z.object({
  jobId: uuidSchema,
  type: z.enum([
    'TRANSCRIPT_JSON',
    'TRANSCRIPT_VTT',
    'TRANSCRIPT_TXT',
    'WAVEFORM_JSON',
    'SUMMARY_MD',
    'SUMMARY_JSON',
    'SUBTITLE_VTT',
    'TRANSLATION_VTT',
    'TRANSLATION_MD',
    'DUBBED_AUDIO',
    'DUBBED_VIDEO',
  ]),
  language: languageCodeSchema.nullable(),
  blobKey: z.string().min(1).max(1_024),
  sizeBytes: z.number().int().min(0).max(50 * 1024 * 1024 * 1024),
  mimeType: z.string().min(1).max(120),
  /** SHA-256 hex string. */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/, 'must be sha256 hex'),
  /**
   * When ≤ 64KB, the worker may inline the body so the app can render
   * without a storage fetch. Will be encrypted at rest via encryptPII.
   */
  inlineBody: z.string().max(64 * 1024).optional(),
  modelId: z.string().max(120).optional(),
  modelVersion: z.string().max(80).optional(),
  /**
   * Speaker map produced by diarization. Only set on TRANSCRIPT_JSON.
   * The app upserts `Speaker` rows from this.
   */
  speakerMap: z
    .array(
      z.object({
        diarLabel: z.string().min(1).max(40),
        totalSpeechSec: z.number().int().min(0),
        // ADR-013: per il multitrack l'identità è certa (dal JWT) → il
        // worker la manda qui e il portale popola Speaker.displayName
        // senza mapping manuale. Assente per la diarization pyannote.
        displayName: z.string().max(200).nullable().optional(),
      }),
    )
    .optional(),
});

export type ArtifactRegister = z.infer<typeof artifactRegisterSchema>;

// ── Enqueue helpers (used by webhook recording extension) ────────

/** Inputs accepted by `enqueuePostprodForRecording`. */
export const enqueueRequestSchema = z.object({
  recordingId: uuidSchema,
  sourceLanguage: languageCodeSchema.optional(),
  targetLanguages: z.array(languageCodeSchema).optional(),
  features: z.object({
    transcribe: z.boolean(),
    summarize: z.boolean(),
    translate: z.boolean(),
    subtitle: z.boolean(),
  }),
});

export type EnqueueRequest = z.infer<typeof enqueueRequestSchema>;
