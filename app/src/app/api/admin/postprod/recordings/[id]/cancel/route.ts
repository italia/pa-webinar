// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/admin/postprod/recordings/[id]/cancel
 *
 * Mark every non-terminal PostprodJob for this recording as FAILED.
 * A recording still queued becomes POSTPROD_FAILED; any other status
 * stays, so outputs already public remain visible. Workers in flight will
 * still finish — their lease push doesn't get cancelled mid-run —
 * but their artifact-register call will succeed only against rows
 * they already own; the new FAILED state stops new work from being
 * claimed.
 *
 * Idempotent.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireRecordingManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  // Dell'evento della registrazione: l'admin o chi l'ha creato (ADR-014).
  await requireRecordingManager(await cookies(), id);

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
    // Fallisce solo cio' che e' ancora in coda, anche se di lavori aperti non ne
    // restano. Fermare una lingua aggiunta a una registrazione gia' pronta non
    // deve nasconderne i risultati.
    await tx.recording.updateMany({
      where: { id, status: { in: ['POSTPROD_QUEUED', 'POSTPROD_RUNNING'] } },
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
