/**
 * Server-side helper to enqueue a postprod pipeline for a Recording.
 *
 * Called from:
 *   - `POST /api/webhooks/recording` after a Jibri upload completes,
 *   - admin UI "Re-run pipeline" action (bumps Recording.runCount and
 *     enqueues a fresh set of jobs),
 *   - the post-event lifecycle hook (when an admin flips
 *     `Event.aiTranscriptEnabled` on a recording that already exists).
 *
 * The function is idempotent thanks to the unique `idempotency_key`
 * column on `postprod_jobs`. It uses a Prisma transaction so an
 * intermediate error doesn't leave a half-enqueued pipeline.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { deriveIdempotencyKey } from './idempotency';
import { parseTargetLocales } from './providers';

export interface EnqueueOptions {
  recordingId: string;
  /** ISO-639-1 (default 'it'). */
  sourceLanguage?: string;
  /**
   * ADR-013: quando true il job radice è TRANSCRIBE_MULTITRACK (una
   * traccia per partecipante, attribuzione certa) invece di TRANSCRIBE
   * (mix + diarization pyannote). Il resto della pipeline è identico:
   * dipende dallo stesso TRANSCRIPT_JSON prodotto dal job radice.
   */
  multitrack?: boolean;
}

export interface EnqueueResult {
  enqueued: number;
  skippedExisting: number;
  jobIds: string[];
}

/**
 * Build the dependency graph and INSERT rows. The shape:
 *
 *   TRANSCRIBE (always, when ai_transcript_enabled=true)
 *     ├── SUMMARIZE              (when ai_summary_enabled=true)
 *     │     └── for each target lang: TRANSLATE (when translation_enabled=true)
 *     └── for each target lang: TRANSLATE for transcripts
 *
 * SUBTITLE is satisfied directly by TRANSCRIBE producing a TRANSCRIPT_VTT
 * in the source language, so we don't enqueue a separate SUBTITLE job
 * for the source language. Translation jobs produce TRANSLATION_VTT
 * which the player consumes as a subtitle track.
 */
export async function enqueuePostprodForRecording(
  tx: PrismaClient | Prisma.TransactionClient,
  opts: EnqueueOptions,
): Promise<EnqueueResult> {
  const recording = await tx.recording.findUnique({
    where: { id: opts.recordingId },
    include: {
      event: {
        select: {
          id: true,
          aiTranscriptEnabled: true,
          aiSummaryEnabled: true,
          aiTranslationEnabled: true,
          aiDubbingEnabled: true,
          multitrackRecordingEnabled: true,
          aiTargetLocales: true,
        },
      },
    },
  });

  if (!recording) {
    throw new Error(`recording not found: ${opts.recordingId}`);
  }
  if (!recording.event.aiTranscriptEnabled) {
    // Without transcription nothing else can run. Silently no-op so
    // the webhook stays idempotent across event configuration toggles.
    return { enqueued: 0, skippedExisting: 0, jobIds: [] };
  }

  // Master kill-switch: when an operator pauses the AI pipeline
  // cluster-wide via SiteSetting.aiPipelineEnabled=false, every
  // enqueue path (webhook, admin rerun, post-event lifecycle) is a
  // no-op. Without this, an admin could fill the queue with orphan
  // jobs while the orchestrator is paused.
  const site = await tx.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true },
  });
  if (!site?.aiPipelineEnabled) {
    return { enqueued: 0, skippedExisting: 0, jobIds: [] };
  }

  const sourceLanguage = opts.sourceLanguage ?? recording.sourceLanguage ?? 'it';
  const runCount = recording.runCount;

  // Snapshot consent flags at enqueue time. Even if an admin flips
  // them off later, already-produced artifacts remain governed by the
  // snapshot until manual purge.
  await tx.recording.update({
    where: { id: recording.id },
    data: {
      consentSnapshot: {
        aiTranscriptEnabled: recording.event.aiTranscriptEnabled,
        aiSummaryEnabled: recording.event.aiSummaryEnabled,
        aiTranslationEnabled: recording.event.aiTranslationEnabled,
        multitrackRecordingEnabled: recording.event.multitrackRecordingEnabled,
        aiTargetLocales: recording.event.aiTargetLocales,
        sourceLanguage,
        snapshotAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
      status: 'POSTPROD_QUEUED',
      sourceLanguage,
    },
  });

  // Resolve target locales from event override or site default. The
  // siteSettings row may not exist on a fresh deploy — caller has to
  // ensure it does (the rest of the codebase already assumes it).
  let targetLocales: string[] = [];
  if (recording.event.aiTranslationEnabled) {
    if (recording.event.aiTargetLocales) {
      targetLocales = parseTargetLocales(recording.event.aiTargetLocales);
    } else {
      const site = await tx.siteSetting.findUnique({
        where: { id: 'singleton' },
        select: { aiDefaultTargetLocales: true },
      });
      targetLocales = parseTargetLocales(site?.aiDefaultTargetLocales);
    }
    // Never translate to the source language.
    targetLocales = targetLocales.filter((l) => l !== sourceLanguage);
  }

  type PendingJob = {
    kind: 'TRANSCRIBE' | 'TRANSCRIBE_MULTITRACK' | 'SUMMARIZE' | 'TRANSLATE' | 'DUB';
    payload: Record<string, unknown>;
    dependsOnKey?: string; // forward reference resolved via map below
    key: string;
  };

  const transcribeKey = `transcribe`;
  const summarizeKey = `summarize`;

  const pending: PendingJob[] = [];

  pending.push({
    kind: opts.multitrack ? 'TRANSCRIBE_MULTITRACK' : 'TRANSCRIBE',
    payload: {
      runId: recording.id,
      sourceLanguage,
    },
    key: transcribeKey,
  });

  if (recording.event.aiSummaryEnabled) {
    pending.push({
      kind: 'SUMMARIZE',
      payload: {
        runId: recording.id,
        sourceLanguage,
      },
      dependsOnKey: transcribeKey,
      key: summarizeKey,
    });
  }

  for (const lang of targetLocales) {
    const translateKey = `translate-${lang}`;
    pending.push({
      kind: 'TRANSLATE',
      payload: {
        runId: recording.id,
        sourceLanguage,
        targetLanguage: lang,
      },
      dependsOnKey: recording.event.aiSummaryEnabled
        ? summarizeKey
        : transcribeKey,
      key: translateKey,
    });

    // DUB job per la lingua, depende dal TRANSLATE che produce il
    // transcript tradotto. Solo se l'admin ha abilitato dubbing per
    // l'evento — feature opt-in per evitare di generare audio
    // sintetico non desiderato.
    if (recording.event.aiDubbingEnabled) {
      pending.push({
        kind: 'DUB',
        payload: {
          runId: recording.id,
          sourceLanguage,
          targetLanguage: lang,
        },
        dependsOnKey: translateKey,
        key: `dub-${lang}`,
      });
    }
  }

  // INSERT in dependency order so dependsOnId can be filled in.
  const idByKey: Record<string, string> = {};
  let enqueued = 0;
  let skipped = 0;
  const jobIds: string[] = [];

  for (const job of pending) {
    const idempotencyKey = deriveIdempotencyKey({
      recordingId: recording.id,
      kind: job.kind,
      runCount,
      payload: job.payload,
    });

    const existing = await tx.postprodJob.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      idByKey[job.key] = existing.id;
      jobIds.push(existing.id);
      continue;
    }

    const created = await tx.postprodJob.create({
      data: {
        recordingId: recording.id,
        kind: job.kind,
        payload: job.payload as Prisma.InputJsonValue,
        idempotencyKey,
        dependsOnId: job.dependsOnKey ? idByKey[job.dependsOnKey] ?? null : null,
      },
      select: { id: true },
    });

    idByKey[job.key] = created.id;
    jobIds.push(created.id);
    enqueued += 1;
  }

  return { enqueued, skippedExisting: skipped, jobIds };
}

export interface EnqueueTranslateLanguageResult {
  /** true if a new TRANSLATE job was created, false if it already existed. */
  enqueued: boolean;
  jobId: string;
  /** Idempotency key of the (created or existing) TRANSLATE job. */
  idempotencyKey: string;
}

/**
 * Enqueue a SINGLE TRANSLATE job for one target language, on demand
 * (admin "add a translation language" action). This is a narrow,
 * additive counterpart to `enqueuePostprodForRecording`: it does NOT
 * touch recording status, consent snapshot, runCount, or any other job
 * in the pipeline.
 *
 * Preconditions the CALLER must enforce (kept out of here so the helper
 * stays composable and the API route can return precise HTTP errors):
 *   - the master kill-switch `SiteSetting.aiPipelineEnabled` is on,
 *   - a TRANSCRIPT_JSON artifact already exists for the recording,
 *   - `targetLanguage` is neither the source language nor already
 *     translated.
 *
 * The TRANSLATE job depends on the root job that produced the existing
 * TRANSCRIPT_JSON, preserving the orchestrator's "ready jobs" ordering
 * invariant. Because the transcript already exists, the dependency is
 * effectively already satisfied.
 *
 * Idempotent: re-invoking for an already-queued language returns the
 * existing job (`enqueued: false`).
 */
export async function enqueueTranslateLanguage(
  tx: PrismaClient | Prisma.TransactionClient,
  opts: { recordingId: string; targetLanguage: string },
): Promise<EnqueueTranslateLanguageResult> {
  const recording = await tx.recording.findUnique({
    where: { id: opts.recordingId },
    select: { id: true, runCount: true, sourceLanguage: true },
  });
  if (!recording) {
    throw new Error(`recording not found: ${opts.recordingId}`);
  }

  const sourceLanguage = recording.sourceLanguage ?? 'it';

  // Locate the existing TRANSCRIPT_JSON and the root job that produced
  // it, so the new TRANSLATE job both references the transcript artifact
  // in its payload and depends on the correct precursor.
  const transcriptArtifact = await tx.postprodArtifact.findFirst({
    where: { recordingId: recording.id, type: 'TRANSCRIPT_JSON' },
    select: { id: true, jobId: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!transcriptArtifact) {
    throw new Error(`no TRANSCRIPT_JSON for recording: ${opts.recordingId}`);
  }

  const payload = {
    runId: recording.id,
    sourceLanguage,
    targetLanguage: opts.targetLanguage,
    transcriptArtifactId: transcriptArtifact.id,
  };

  const idempotencyKey = deriveIdempotencyKey({
    recordingId: recording.id,
    kind: 'TRANSLATE',
    runCount: recording.runCount,
    payload,
  });

  const existing = await tx.postprodJob.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing) {
    return { enqueued: false, jobId: existing.id, idempotencyKey };
  }

  const created = await tx.postprodJob.create({
    data: {
      recordingId: recording.id,
      kind: 'TRANSLATE',
      payload: payload as Prisma.InputJsonValue,
      idempotencyKey,
      dependsOnId: transcriptArtifact.jobId,
    },
    select: { id: true },
  });

  return { enqueued: true, jobId: created.id, idempotencyKey };
}
