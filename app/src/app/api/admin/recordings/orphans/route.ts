/**
 * Admin-facing endpoints for the orphan recordings workflow.
 *
 *   GET  → list all orphan_recordings rows with computed `deletesAt`
 *          (based on SiteSetting.orphanRecordingGraceDays) so the UI
 *          can render a countdown per row.
 *   POST → bulk update decision: { ids: string[], decision: 'ignore'|
 *          'delete-now'|'pending' }. The cron will apply the decision
 *          on the next sweep.
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const DECISION_VALUES = ['pending', 'ignore', 'delete-now'] as const;

const bulkDecisionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  decision: z.enum(DECISION_VALUES),
});

export const GET = withErrorHandling(async () => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const [rows, settings] = await Promise.all([
    prisma.orphanRecording.findMany({
      orderBy: { discoveredAt: 'desc' },
      take: 1000,
    }),
    prisma.siteSetting.findFirst({
      select: { orphanRecordingGraceDays: true },
    }),
  ]);

  const graceDays = settings?.orphanRecordingGraceDays ?? 30;

  let totalBytes = 0n;
  const serialised = rows.map((r) => {
    const size = r.sizeBytes ?? 0n;
    totalBytes += size;
    const deletesAt =
      r.decision === 'pending' && graceDays > 0
        ? new Date(r.discoveredAt.getTime() + graceDays * 86400_000).toISOString()
        : r.decision === 'delete-now'
          ? 'next-sweep'
          : null;
    return {
      id: r.id,
      blobName: r.blobName,
      sizeBytes: r.sizeBytes?.toString() ?? null,
      lastModified: r.lastModified?.toISOString() ?? null,
      discoveredAt: r.discoveredAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      decision: r.decision,
      note: r.note,
      deletesAt,
    };
  });

  return Response.json({
    rows: serialised,
    total: rows.length,
    totalBytes: totalBytes.toString(),
    graceDays,
  });
});

export const POST = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const body = await parseJsonBody(request);
  const parsed = bulkDecisionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const result = await prisma.orphanRecording.updateMany({
    where: { id: { in: parsed.data.ids } },
    data: { decision: parsed.data.decision },
  });

  await logAdminAction({
    request,
    action: 'ORPHAN_RECORDING_DECISION',
    details: {
      ids: parsed.data.ids,
      decision: parsed.data.decision,
      updated: result.count,
    },
  });

  return Response.json({ updated: result.count, decision: parsed.data.decision });
});
