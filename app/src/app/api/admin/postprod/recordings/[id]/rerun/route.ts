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
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { enqueuePostprodForRecording } from '@/lib/ai/enqueue';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = (await (context as { params: Promise<{ id: string }> }).params);

  const result = await prisma.$transaction(async (tx) => {
    const recording = await tx.recording.findUnique({
      where: { id },
      select: { id: true, runCount: true, eventId: true },
    });
    if (!recording) throw new NotFoundError('Recording');

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
