/**
 * POST /api/admin/postprod/recordings/[id]/cancel
 *
 * Mark every non-terminal PostprodJob for this recording as FAILED
 * and the recording itself as POSTPROD_FAILED. Workers in flight will
 * still finish — their lease push doesn't get cancelled mid-run —
 * but their artifact-register call will succeed only against rows
 * they already own; the new FAILED state stops new work from being
 * claimed.
 *
 * Idempotent.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = (await (context as { params: Promise<{ id: string }> }).params);

  const recording = await prisma.recording.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!recording) throw new NotFoundError('Recording');

  const result = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.postprodJob.updateMany({
      where: {
        recordingId: id,
        status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
      },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        lastError: 'cancelled by admin',
      },
    });
    await tx.recording.update({
      where: { id },
      data: { status: 'POSTPROD_FAILED' },
    });
    return cancelled.count;
  });

  await logAdminAction({
    request,
    action: 'POSTPROD_CANCEL',
    target: id,
    details: { cancelled: result },
  });

  return Response.json({ ok: true, cancelled: result });
});
