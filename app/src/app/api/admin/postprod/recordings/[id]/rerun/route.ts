/**
 * POST /api/admin/postprod/recordings/[id]/rerun
 *
 * Manual "re-run pipeline" from the admin UI. Bumps
 * `Recording.runCount` (so the new jobs get distinct idempotency keys
 * and a distinct storage prefix) and enqueues a fresh pipeline.
 *
 * Does NOT delete previous artifacts — they live under the older
 * `runId` prefix and are GC'd by retention.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireRecordingManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { enqueuePostprodForRecording } from '@/lib/ai/enqueue';
import { registrazioneSoloSottotitoli, trascrizioneCorrettaDaiSottotitoli } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const { id } = (await (context as { params: Promise<{ id: string }> }).params);
  // Dell'evento della registrazione: l'admin o chi l'ha creato (ADR-014).
  await requireRecordingManager(await cookies(), id);

  // Check the master kill-switch upfront so we don't bump runCount /
  // flip the recording into POSTPROD_QUEUED and then leave it stuck
  // (enqueuePostprodForRecording also short-circuits, but only after
  // the recording state mutation in the transaction below).
  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true },
  });
  if (!site?.aiPipelineEnabled) {
    throw new ValidationError(
      'AI pipeline is currently disabled (SiteSetting.aiPipelineEnabled=false). Enable it in admin settings before re-running.',
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const recording = await tx.recording.findUnique({
      where: { id },
      select: {
        id: true,
        runCount: true,
        eventId: true,
        blobKey: true,
        event: { select: { aiTranscriptEnabled: true } },
      },
    });
    if (!recording) throw new NotFoundError('Recording');
    if (await trascrizioneCorrettaDaiSottotitoli(tx, recording.id)) {
      throw new ConflictError(
        'The transcript from the live captions on this recording was corrected by hand: the AI transcription would replace it and the corrections would be lost.',
      );
    }
    if (registrazioneSoloSottotitoli(recording)) {
      throw new ValidationError(
        'This recording has no media: its transcript comes from the live captions. Update it from the captions instead.',
      );
    }

    // Rerun re-runs an EXISTING pipeline; with AI transcript disabled the
    // enqueue no-ops. Throw BEFORE the status mutation so the recording stays
    // at READY and the "Genera AI" button (which enables the flag) remains
    // available — otherwise a mistaken Rerun strands it in POSTPROD_QUEUED with
    // zero jobs and no way back.
    if (!recording.event.aiTranscriptEnabled) {
      throw new ValidationError(
        'AI transcript is disabled for this event. Use "Genera AI" to enable AI processing and start the pipeline.',
      );
    }

    await tx.recording.update({
      where: { id: recording.id },
      data: {
        runCount: { increment: 1 },
        status: 'POSTPROD_QUEUED',
      },
    });
    return enqueuePostprodForRecording(tx, { recordingId: recording.id });
  });

  await logAdminAction({
    request,
    action: 'POSTPROD_RERUN',
    target: id,
    details: { enqueued: result.enqueued, skipped: result.skippedExisting },
  });

  return Response.json({ ok: true, ...result });
});
