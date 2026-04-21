/**
 * GET /api/cron/email-outbox
 *
 * Drains the EmailOutbox queue. Claims a batch of PENDING rows whose
 * `nextAttemptAt` has elapsed, then sends them via the pooled SMTP
 * transport with bounded parallelism.
 *
 * Safe to run concurrently: claiming uses `FOR UPDATE SKIP LOCKED` with
 * an atomic lease (push `nextAttemptAt` into the future) so competing
 * runs never pick the same row. If a pod crashes mid-send, the lease
 * expires and the row is reclaimed on the next tick — at-least-once
 * delivery, which is what SMTP already provides anyway.
 *
 * Protected by CRON_API_KEY. In production, driven by a Kubernetes
 * CronJob every minute.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import {
  MAX_EMAIL_OUTBOX_ATTEMPTS,
  nextAttemptDelayMs,
} from '@/lib/email/outbox';

export const dynamic = 'force-dynamic';

// Per-run ceiling. At 1 email/sec (slow provider) a batch of 50 takes
// ~50s — fits inside the 60s cron interval with headroom.
const BATCH_SIZE = 50;
// Matches SMTP pool maxConnections default so we saturate but don't
// starve it.
const PARALLELISM = 5;
// Lease horizon. A send that takes longer than this is almost certainly
// hung; letting the row be reclaimed is the recovery path.
const LEASE_MS = 5 * 60_000;

interface ClaimedRow {
  id: string;
  to_address: string;
  subject: string;
  html: string;
  text: string | null;
  attachments: unknown;
  attempts: number;
}

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const leaseUntil = new Date(Date.now() + LEASE_MS);

  // Atomic claim: select due PENDING rows with SKIP LOCKED, then push
  // their `nextAttemptAt` into the future so concurrent/overlapping
  // runs don't see them. Single round-trip.
  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    WITH claimed AS (
      SELECT id FROM email_outbox
      WHERE status = 'PENDING' AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE email_outbox o
    SET next_attempt_at = ${leaseUntil}
    FROM claimed
    WHERE o.id = claimed.id
    RETURNING o.id, o.to_address, o.subject, o.html, o.text, o.attachments, o.attempts
  `;

  if (claimed.length === 0) {
    return Response.json({
      ok: true,
      processed: 0,
      sent: 0,
      retried: 0,
      failed: 0,
    });
  }

  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (let i = 0; i < claimed.length; i += PARALLELISM) {
    const chunk = claimed.slice(i, i + PARALLELISM);
    await Promise.allSettled(
      chunk.map(async (row) => {
        try {
          await sendEmail({
            to: row.to_address,
            subject: row.subject,
            html: row.html,
            text: row.text ?? undefined,
            attachments: Array.isArray(row.attachments)
              ? (row.attachments as Array<{
                  filename: string;
                  content: string;
                  contentType: string;
                }>)
              : undefined,
          });

          await prisma.emailOutbox.update({
            where: { id: row.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              lastError: null,
            },
          });
          sent++;
        } catch (err) {
          const newAttempts = row.attempts + 1;
          const message = err instanceof Error ? err.message : String(err);
          const giveUp = newAttempts >= MAX_EMAIL_OUTBOX_ATTEMPTS;

          await prisma.emailOutbox.update({
            where: { id: row.id },
            data: {
              attempts: newAttempts,
              // lastError is capped so a pathological SMTP trace can't
              // blow up the column.
              lastError: message.slice(0, 1000),
              status: giveUp ? 'FAILED' : 'PENDING',
              nextAttemptAt: giveUp
                ? new Date()
                : new Date(Date.now() + nextAttemptDelayMs(newAttempts)),
            },
          });

          if (giveUp) {
            failed++;
            console.error(
              `[cron/email-outbox] permanent failure for ${row.id} after ${newAttempts} attempts: ${message}`,
            );
          } else {
            retried++;
          }
        }
      }),
    );
  }

  return Response.json({
    ok: true,
    processed: claimed.length,
    sent,
    retried,
    failed,
  });
});
