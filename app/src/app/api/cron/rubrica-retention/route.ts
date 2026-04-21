/**
 * GET /api/cron/rubrica-retention
 *
 * Inactive-person retention cleanup (GDPR Art. 5.1.e — storage limitation).
 * Runs once a day. Deletes Person rows whose `lastActiveAt` is older than
 * `retentionMonths`. Linked Registration rows keep existing with their
 * `personId` cleared via onDelete: SetNull, so per-event consent trails
 * remain auditable.
 *
 * Protected by CRON_API_KEY.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { assertCronApiKey } from '@/lib/auth/cron';

export const dynamic = 'force-dynamic';

// Process in batches to keep transaction sizes small and make the job
// interruptible.
const BATCH_SIZE = 500;

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const now = new Date();
  let totalDeleted = 0;
  let totalOptedOutDeleted = 0;

  // Persons who exercised opt-out: delete immediately (no use keeping
  // the row — the participant explicitly said "forget me").
  const optedOut = await prisma.person.findMany({
    where: { optedInToAddressBook: false, optedOutAt: { not: null } },
    select: { id: true },
    take: BATCH_SIZE,
  });
  if (optedOut.length > 0) {
    const res = await prisma.person.deleteMany({
      where: { id: { in: optedOut.map((p) => p.id) } },
    });
    totalOptedOutDeleted += res.count;
  }

  // Persons past retention — compute cutoff per row because
  // `retentionMonths` is configurable per-person (defaults to 24).
  // Loop is bounded by BATCH_SIZE so the cron never runs forever.
  const candidates = await prisma.person.findMany({
    where: { optedInToAddressBook: true },
    select: { id: true, lastActiveAt: true, retentionMonths: true },
    take: BATCH_SIZE,
    orderBy: { lastActiveAt: 'asc' },
  });

  const expired: string[] = [];
  for (const p of candidates) {
    const cutoff = new Date(p.lastActiveAt);
    cutoff.setMonth(cutoff.getMonth() + p.retentionMonths);
    if (cutoff < now) expired.push(p.id);
  }

  if (expired.length > 0) {
    const res = await prisma.person.deleteMany({
      where: { id: { in: expired } },
    });
    totalDeleted += res.count;
  }

  console.log(
    `[cron/rubrica-retention] deleted ${totalDeleted} expired persons, ${totalOptedOutDeleted} opted-out persons`,
  );

  return Response.json({
    ok: true,
    expiredDeleted: totalDeleted,
    optedOutDeleted: totalOptedOutDeleted,
    scanned: candidates.length,
  });
});
