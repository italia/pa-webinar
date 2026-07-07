/**
 * POST /api/admin/events/[id]/generate-ai
 *
 * One-click "generate AI post-event". Closes the trap where enabling
 * Event.aiTranscriptEnabled AFTER the event does nothing: flipping the flag
 * alone never enqueues (the pipeline only auto-enqueues on the Jibri finalize
 * webhook, reading the flag as it was at that moment). For an event that already
 * has a Recording, this flips aiTranscriptEnabled (+ optionally aiSummaryEnabled)
 * AND enqueues the pipeline in the SAME transaction, so
 * enqueuePostprodForRecording's live flag read sees `true`.
 *
 * If no Recording exists yet (nothing was captured — capture is live-only),
 * returns 404: there is nothing to post-process. Unlike the rerun endpoint this
 * does NOT bump runCount (it's a first-time generate); enqueue is idempotent, so
 * clicking twice is safe.
 *
 * Optional JSON body: { summary?: boolean } to also enable the AI summary stage.
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
  try {
    const body = (await request.json()) as { summary?: boolean } | null;
    alsoSummary = body?.summary === true;
  } catch {
    /* no body → transcript only */
  }

  const result = await prisma.$transaction(async (tx) => {
    // Latest recording for the event (an event can have multiple CallSessions,
    // hence multiple Recordings — pick the most recent, same as the postprod list).
    const recording = await tx.recording.findFirst({
      where: { eventId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!recording) throw new NotFoundError('Recording');

    // Flip the AI flags FIRST, in the same transaction, so the live flag read
    // inside enqueuePostprodForRecording (which no-ops when aiTranscriptEnabled
    // is false) sees `true`. This is exactly the step the plain PUT never did.
    await tx.event.update({
      where: { id },
      data: {
        aiTranscriptEnabled: true,
        ...(alsoSummary && { aiSummaryEnabled: true }),
      },
    });

    return enqueuePostprodForRecording(tx, { recordingId: recording.id });
  });

  await logAdminAction({
    request,
    action: 'POSTPROD_RERUN',
    target: id,
    details: {
      source: 'generate-ai',
      enqueued: result.enqueued,
      skipped: result.skippedExisting,
    },
  });

  return Response.json({ ok: true, ...result });
});
