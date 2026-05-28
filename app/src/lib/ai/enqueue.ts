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
    kind: 'TRANSCRIBE' | 'SUMMARIZE' | 'TRANSLATE' | 'DUB';
    payload: Record<string, unknown>;
    dependsOnKey?: string; // forward reference resolved via map below
    key: string;
  };

  const transcribeKey = `transcribe`;
  const summarizeKey = `summarize`;

  const pending: PendingJob[] = [];

  pending.push({
    kind: 'TRANSCRIBE',
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
