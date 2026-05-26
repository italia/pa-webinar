/**
 * Email outbox — durable queue for outgoing emails.
 *
 * Producers call `enqueueEmail` (a single DB INSERT). The cron
 * `/api/cron/email-outbox` drains PENDING rows with FOR UPDATE SKIP
 * LOCKED, sends them via the SMTP pool, and retries with exponential
 * backoff on failure.
 */

import { Prisma } from '@prisma/client';

import { encryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';

export interface EnqueueEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    // nodemailer accepts utf8 strings for text attachments and base64
    // via `encoding: 'base64'` for binary. We persist the string as-is
    // in JSONB and re-hydrate at send time.
    content: string;
    contentType: string;
  }>;
  // Free-form metadata — e.g. { kind: 'confirmation', registrationId }
  // — kept purely for audit/debug; the processor never reads it.
  metadata?: Record<string, unknown>;
}

export async function enqueueEmail(input: EnqueueEmailInput): Promise<string> {
  // toAddress, html and text are encrypted at rest so a database dump
  // or admin SELECT doesn't leak the recipient list, the personalized
  // greeting, or magic-link tokens embedded in the body. The cron
  // processor decrypts before handing the row to nodemailer.
  //
  // `subject` is intentionally left in plaintext: it's almost always
  // just the event title (already public on the event page) and
  // keeping it readable makes operational triage (DB queries, log
  // scans, the FAILED row inspector in the admin panel) much easier.
  const row = await prisma.emailOutbox.create({
    data: {
      toAddress: encryptPII(input.to),
      subject: input.subject,
      html: encryptPII(input.html),
      text: input.text != null ? encryptPII(input.text) : null,
      attachments: input.attachments
        ? (input.attachments as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      metadata: input.metadata
        ? (input.metadata as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Exponential backoff schedule. attempts is the NEW attempts value
 * after the failure (i.e. 1 on first failure). After MAX_ATTEMPTS the
 * row transitions to FAILED.
 */
export function nextAttemptDelayMs(attempts: number): number {
  // attempts=1 → 1 min, 2 → 5 min, 3 → 30 min, 4 → 2h, 5 → 12h.
  const delaysMin = [1, 5, 30, 120, 720];
  const idx = Math.min(attempts - 1, delaysMin.length - 1);
  return delaysMin[idx]! * 60_000;
}

export const MAX_EMAIL_OUTBOX_ATTEMPTS = 6;
