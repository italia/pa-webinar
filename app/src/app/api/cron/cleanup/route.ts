import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { constantTimeEqual } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/cleanup
 *
 * GDPR data cleanup: deletes participant PII, questions, and upvotes
 * for events whose retention period has expired.
 *
 * Logic:
 *   1. Find events where status is ENDED or ARCHIVED
 *      AND endsAt + dataRetentionDays < NOW()
 *   2. For each event, in a transaction:
 *      a. Delete all question_upvotes for the event's questions
 *      b. Delete all questions for the event
 *      c. Delete all registrations (removes all PII)
 *      d. Set status to ARCHIVED
 *   3. Return a JSON summary
 *
 * Protected by CRON_API_KEY.
 * In production, called daily at 03:00 UTC via a Kubernetes CronJob.
 */
export async function GET(request: Request) {
  const apiKey = process.env.CRON_API_KEY;
  const providedKey = request.headers.get('x-api-key') ?? '';

  if (!apiKey || !constantTimeEqual(providedKey, apiKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  const expiredEvents = await prisma.event.findMany({
    where: {
      status: { in: ['ENDED', 'ARCHIVED'] },
    },
    select: {
      id: true,
      slug: true,
      endsAt: true,
      dataRetentionDays: true,
      status: true,
      recordingUrl: true,
      _count: { select: { registrations: true, questions: true } },
    },
  });

  const toClean = expiredEvents.filter((evt) => {
    const retentionExpiry = new Date(
      evt.endsAt.getTime() + evt.dataRetentionDays * 86_400_000,
    );
    return retentionExpiry < now;
  });

  let totalRegistrationsDeleted = 0;
  let totalQuestionsDeleted = 0;
  let eventsProcessed = 0;

  for (const evt of toClean) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const upvotesDeleted = await tx.questionUpvote.deleteMany({
          where: { question: { eventId: evt.id } },
        });

        const questionsDeleted = await tx.question.deleteMany({
          where: { eventId: evt.id },
        });

        const registrationsDeleted = await tx.registration.deleteMany({
          where: { eventId: evt.id },
        });

        if (evt.status !== 'ARCHIVED') {
          await tx.event.update({
            where: { id: evt.id },
            data: { status: 'ARCHIVED' },
          });
        }

        return {
          upvotes: upvotesDeleted.count,
          questions: questionsDeleted.count,
          registrations: registrationsDeleted.count,
        };
      });

      // GDPR: recording blobs should be deleted when retention expires.
      if (evt.recordingUrl) {
        console.warn(
          `[cron/cleanup] Event ${evt.id} has a recording at ${evt.recordingUrl} ` +
            `that should be deleted from Azure Blob Storage. ` +
            `Implement Azure SDK deletion when AZURE_STORAGE_CONNECTION_STRING is available.`,
        );
      }

      console.error(
        `[cron/cleanup] Cleaned event ${evt.id} (${evt.slug}): ` +
          `${result.registrations} registrations, ${result.questions} questions, ${result.upvotes} upvotes deleted`,
      );

      totalRegistrationsDeleted += result.registrations;
      totalQuestionsDeleted += result.questions;
      eventsProcessed++;
    } catch (err) {
      console.error(
        `[cron/cleanup] Failed to clean event ${evt.id} (${evt.slug}):`,
        err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    eventsProcessed,
    registrationsDeleted: totalRegistrationsDeleted,
    questionsDeleted: totalQuestionsDeleted,
  });
}
