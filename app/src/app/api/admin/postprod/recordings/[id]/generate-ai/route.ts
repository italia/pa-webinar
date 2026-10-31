/**
 * POST /api/admin/postprod/recordings/[id]/generate-ai
 *
 * Recording-scoped "start the AI pipeline" for the admin postprod page.
 *
 * Closes a dead end: a recording captured while the event had AI disabled
 * (or an AUDIO-ONLY multitrack recording, whose transcription only ever
 * auto-enqueues at event end) sits at status=READY with zero jobs, and every
 * launch control on the page is gated on an existing transcript. The plain
 * "Rerun" endpoint no-ops here because it never flips the AI flags.
 *
 * This endpoint flips the event's AI flags (transcript always; summary /
 * translation opt-in via the body) AND enqueues in the SAME transaction, so
 * `enqueuePostprodForRecording`'s live flag read sees `true`. The enqueue
 * auto-detects multitrack from the recording's blobKey, so an audio-only
 * multitrack recording correctly gets a TRANSCRIBE_MULTITRACK root job.
 *
 * Optional JSON body: { summary?: boolean, translation?: boolean }.
 * Enqueue is idempotent, so clicking twice is safe (no runCount bump).
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireRecordingManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { enqueuePostprodForRecording } from '@/lib/ai/enqueue';
import { leggiCorpoAvvio } from '@/lib/ai/voice-consent';
import { registrazioneSoloSottotitoli, trascrizioneCorrettaDaiSottotitoli } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  // Dell'evento della registrazione: l'admin o chi l'ha creato (ADR-014).
  await requireRecordingManager(await cookies(), id);

  // Master kill-switch first, so we never flip flags then leave nothing enqueued.
  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true },
  });
  if (!site?.aiPipelineEnabled) {
    throw new AppError(
      'AI pipeline is currently disabled (SiteSetting.aiPipelineEnabled=false). Enable it in admin settings first.',
      422,
      'AI_PIPELINE_DISABLED',
    );
  }

  // Senza corpo: solo la trascrizione.
  const corpo = await leggiCorpoAvvio(request);
  const alsoSummary = corpo.summary === true;
  const alsoTranslation = corpo.translation === true;
  const allVoicesConsented = corpo.allVoicesConsented === true;

  const result = await prisma.$transaction(async (tx) => {
    const recording = await tx.recording.findUnique({
      where: { id },
      select: { id: true, eventId: true, blobKey: true },
    });
    if (!recording) throw new NotFoundError('Recording');
    if (await trascrizioneCorrettaDaiSottotitoli(tx, recording.id)) {
      throw new AppError(
        'The transcript from the live captions on this recording was corrected by hand: the AI transcription would replace it and the corrections would be lost.',
        409,
        'TRANSCRIPT_CORRECTED',
      );
    }
    if (registrazioneSoloSottotitoli(recording)) {
      throw new AppError(
        'This recording has no media: its transcript comes from the live captions.',
        422,
        'RECORDING_WITHOUT_MEDIA',
      );
    }

    // Flip the AI flags FIRST, same transaction, so the live read inside
    // enqueuePostprodForRecording (which no-ops when aiTranscriptEnabled is
    // false) sees `true`.
    await tx.event.update({
      where: { id: recording.eventId },
      data: {
        aiTranscriptEnabled: true,
        ...(alsoSummary && { aiSummaryEnabled: true }),
        ...(alsoTranslation && { aiTranslationEnabled: true }),
      },
    });

    return enqueuePostprodForRecording(tx, { recordingId: recording.id, allVoicesConsented });
  });

  await logAdminAction({
    request,
    action: 'POSTPROD_RERUN',
    target: id,
    details: {
      source: 'generate-ai-recording',
      allVoicesConsented,
      enqueued: result.enqueued,
      skipped: result.skippedExisting,
    },
  });

  return Response.json({ ok: true, ...result });
});
