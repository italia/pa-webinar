/**
 * POST /api/gdpr/erasure?t=<signed-token>
 *
 * GDPR Art. 17 (right to erasure) — fulfilment step.
 *
 * Deletes every Registration row for the email-hash carried by the
 * token, along with the cascade-deleted Q&A, poll votes, feedback and
 * reminders attached to those registrations. Recordings tied to the
 * underlying Event are NOT deleted here — they are governed by the
 * event-level retention cron and are subject to separate legal-hold
 * rules.
 *
 * Writes a GdprAuditLog row per affected event (no PII; only counts
 * and an emailHash prefix), mirroring the cron/cleanup audit format.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { AppError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { verifyGdprToken } from '@/lib/gdpr/request-token';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request);
  const rl = rateLimit(`gdpr-erasure:${ip}`, {
    limit: 10,
    windowMs: 3_600_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  if (!token) {
    throw new AppError('Missing token', 400, 'BAD_REQUEST');
  }

  const verified = verifyGdprToken(token, 'erasure');
  if (!verified) {
    throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
  }

  const { emailHash } = verified;

  const registrations = await prisma.registration.findMany({
    where: { emailHash },
    select: { id: true, eventId: true },
  });

  if (registrations.length === 0) {
    return Response.json({ ok: true, deleted: 0 });
  }

  const registrationIds = registrations.map((r) => r.id);
  const eventIds = [...new Set(registrations.map((r) => r.eventId))];

  // Cascade deletes are configured at the Prisma schema level; deleting
  // the Registration rows takes their Q&A, poll votes, reminders and
  // feedback with them.
  const deleted = await prisma.registration.deleteMany({
    where: { id: { in: registrationIds } },
  });

  for (const eventId of eventIds) {
    await prisma.gdprAuditLog.create({
      data: {
        eventId,
        action: 'DATA_DELETED',
        recordCount: registrations.filter((r) => r.eventId === eventId).length,
        details: JSON.stringify({
          source: 'gdpr-erasure-endpoint',
          emailHashPrefix: emailHash.substring(0, 8),
        }),
      },
    });
  }

  return Response.json({ ok: true, deleted: deleted.count });
});
