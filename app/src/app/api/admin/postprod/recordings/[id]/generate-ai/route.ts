/**
 * POST /api/admin/postprod/recordings/[id]/generate-ai
 *
 * Recording-scoped "start the AI pipeline" for the admin postprod page.
 *
 * Closes the F15 trap: a recording captured while the event had AI disabled
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
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { enqueuePostprodForRecording } from '@/lib/ai/enqueue';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  // Master kill-switch first, so we never flip flags then leave nothing enqueued.
  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true },
  });
  if (!site?.aiPipelineEnabled) {
    throw new ValidationError(
      'AI pipeline is currently disabled (SiteSetting.aiPipelineEnabled=false). Enable it in admin settings first.',
    );
  }

  let alsoSummary = false;
  let alsoTranslation = false;
  try {
    const body = (await request.json()) as { summary?: boolean; translation?: boolean } | null;
    alsoSummary = body?.summary === true;
    alsoTranslation = body?.translation === true;
  } catch {
    /* no body → transcript only */
  }

  const result = await prisma.$transaction(async (tx) => {
    const recording = await tx.recording.findUnique({
      where: { id },
      select: { id: true, eventId: true },
    });
    if (!recording) throw new NotFoundError('Recording');

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

    return enqueuePostprodForRecording(tx, { recordingId: recording.id });
  });

  await logAdminAction({
    request,
    action: 'POSTPROD_RERUN',
    target: id,
    details: {
      source: 'generate-ai-recording',
      enqueued: result.enqueued,
      skipped: result.skippedExisting,
    },
  });

  return Response.json({ ok: true, ...result });
});
