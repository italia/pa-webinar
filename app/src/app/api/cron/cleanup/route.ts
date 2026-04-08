import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { assertCronApiKey } from '@/lib/auth/cron';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/cleanup
 *
 * GDPR data cleanup: deletes participant PII, questions, and upvotes
 * for events whose retention period has expired.
 *
 * Protected by CRON_API_KEY.
 * In production, called daily at 03:00 UTC via a Kubernetes CronJob.
 */
export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const now = new Date();

  // ── Phase 1: Clean up expired temporary recordings (24h) ──
  const tempRecordingEvents = await prisma.event.findMany({
    where: {
      tempRecordingUrl: { not: null },
      recordingPublished: false,
      tempRecordingStartedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true, slug: true, tempRecordingUrl: true },
  });

  for (const evt of tempRecordingEvents) {
    try {
      // TODO: Delete from Azure Blob Storage when SDK available
      if (evt.tempRecordingUrl) {
        console.warn(
          `[cron/cleanup] Temp recording for event ${evt.id} should be deleted from storage: ${evt.tempRecordingUrl}`,
        );
      }
      await prisma.$transaction([
        prisma.event.update({
          where: { id: evt.id },
          data: { tempRecordingUrl: null, tempRecordingStartedAt: null },
        }),
        prisma.gdprAuditLog.create({
          data: {
            eventId: evt.id,
            action: 'TEMP_RECORDING_DELETED',
            recordCount: 1,
            details: JSON.stringify({ reason: '24h_expiry' }),
          },
        }),
      ]);
      console.log(`[cron/cleanup] Temp recording cleared for event ${evt.id} (${evt.slug})`);
    } catch (err) {
      console.error(`[cron/cleanup] Failed to clear temp recording for event ${evt.id}:`, err);
    }
  }

  // ── Phase 2: Clean up published recordings past their retention ──
  const recordingRetentionEvents = await prisma.event.findMany({
    where: {
      recordingUrl: { not: null },
      recordingPublished: true,
      recordingDeleteAfterDays: { not: null },
      recordingPublishedAt: { not: null },
    },
    select: {
      id: true,
      slug: true,
      recordingUrl: true,
      recordingDeleteAfterDays: true,
      recordingPublishedAt: true,
    },
  });

  for (const evt of recordingRetentionEvents) {
    if (!evt.recordingPublishedAt || !evt.recordingDeleteAfterDays) continue;
    const expiresAt = new Date(
      evt.recordingPublishedAt.getTime() + evt.recordingDeleteAfterDays * 86_400_000,
    );
    if (expiresAt >= now) continue;

    try {
      // TODO: Delete from Azure Blob Storage when SDK available
      console.warn(
        `[cron/cleanup] Published recording for event ${evt.id} expired, should be deleted from storage: ${evt.recordingUrl}`,
      );
      await prisma.$transaction([
        prisma.event.update({
          where: { id: evt.id },
          data: {
            recordingUrl: null,
            recordingPublished: false,
            recordingPublishedAt: null,
            recordingFileSize: null,
            recordingDuration: null,
            recordingDeleteAfterDays: null,
          },
        }),
        prisma.gdprAuditLog.create({
          data: {
            eventId: evt.id,
            action: 'RECORDING_DELETED',
            recordCount: 1,
            details: JSON.stringify({
              reason: 'retention_expired',
              retentionDays: evt.recordingDeleteAfterDays,
            }),
          },
        }),
      ]);
      console.log(`[cron/cleanup] Published recording cleared for event ${evt.id} (${evt.slug})`);
    } catch (err) {
      console.error(`[cron/cleanup] Failed to clear recording for event ${evt.id}:`, err);
    }
  }

  // ── Phase 3: Full event data retention cleanup ──
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
      tempRecordingUrl: true,
      _count: { select: { registrations: true, questions: true, polls: true } },
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
  let totalPollsDeleted = 0;
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

        const pollVotesDeleted = await tx.pollVote.deleteMany({
          where: { poll: { eventId: evt.id } },
        });

        const pollsDeleted = await tx.poll.deleteMany({
          where: { eventId: evt.id },
        });

        const feedbackDeleted = await tx.eventFeedback.deleteMany({
          where: { eventId: evt.id },
        });

        const wcSubmissionsDeleted = await tx.wordCloudSubmission.deleteMany({
          where: { round: { eventId: evt.id } },
        });

        const wcRoundsDeleted = await tx.wordCloudRound.deleteMany({
          where: { eventId: evt.id },
        });

        const materialsDeleted = await tx.eventMaterial.deleteMany({
          where: { eventId: evt.id },
        });

        const reminderSentDeleted = await tx.reminderSent.deleteMany({
          where: { reminder: { eventId: evt.id } },
        });

        const remindersDeleted = await tx.eventReminder.deleteMany({
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

        const counts = {
          upvotes: upvotesDeleted.count,
          questions: questionsDeleted.count,
          pollVotes: pollVotesDeleted.count,
          polls: pollsDeleted.count,
          feedback: feedbackDeleted.count,
          wordCloudSubmissions: wcSubmissionsDeleted.count,
          wordCloudRounds: wcRoundsDeleted.count,
          materials: materialsDeleted.count,
          remindersSent: reminderSentDeleted.count,
          reminders: remindersDeleted.count,
          registrations: registrationsDeleted.count,
        };

        // GDPR audit log — no PII, only counts
        await tx.gdprAuditLog.create({
          data: {
            eventId: evt.id,
            action: 'DATA_DELETED',
            recordCount: counts.registrations,
            details: JSON.stringify(counts),
          },
        });

        return counts;
      });

      if (evt.recordingUrl || evt.tempRecordingUrl) {
        console.warn(
          `[cron/cleanup] Event ${evt.id} has recordings that should be deleted from storage. ` +
            `recordingUrl: ${evt.recordingUrl ?? 'none'}, tempRecordingUrl: ${evt.tempRecordingUrl ?? 'none'}`,
        );
      }

      console.log(
        `[cron/cleanup] Cleaned event ${evt.id} (${evt.slug}): ` +
          `${result.registrations} registrations, ${result.questions} questions, ${result.upvotes} upvotes, ${result.polls} polls, ${result.pollVotes} poll votes, ${result.materials} materials deleted`,
      );

      totalRegistrationsDeleted += result.registrations;
      totalQuestionsDeleted += result.questions;
      totalPollsDeleted += result.polls;
      eventsProcessed++;
    } catch (err) {
      console.error(
        `[cron/cleanup] Failed to clean event ${evt.id} (${evt.slug}):`,
        err,
      );
    }
  }

  return Response.json({
    ok: true,
    tempRecordingsCleaned: tempRecordingEvents.length,
    publishedRecordingsCleaned: recordingRetentionEvents.filter((evt) => {
      if (!evt.recordingPublishedAt || !evt.recordingDeleteAfterDays) return false;
      const expiresAt = new Date(
        evt.recordingPublishedAt.getTime() + evt.recordingDeleteAfterDays * 86_400_000,
      );
      return expiresAt < now;
    }).length,
    eventsProcessed,
    registrationsDeleted: totalRegistrationsDeleted,
    questionsDeleted: totalQuestionsDeleted,
    pollsDeleted: totalPollsDeleted,
  });
});
