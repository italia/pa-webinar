import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { assertCronApiKey } from '@/lib/auth/cron';
import { deleteRecordingBlob } from '@/lib/storage/recordings';
import { deleteBlob, isAzureConfigured } from '@/lib/azure/blob-storage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/cleanup
 *
 * GDPR data cleanup: deletes participant PII — registrations, questions,
 * upvotes, poll votes, questionnaire responses, chat messages (encrypted),
 * agenda reactions — for events whose retention period has expired.
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
      // Delete the blob first (network I/O — kept OUTSIDE the transaction).
      // deleteRecordingBlob is best-effort: it no-ops + warns when storage
      // isn't configured (dev) or the URL can't be parsed, and returns false
      // rather than throwing, so a storage hiccup never blocks the DB cleanup.
      if (evt.tempRecordingUrl) {
        await deleteRecordingBlob(evt.tempRecordingUrl).catch(() => false);
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
      console.log(
        `[cron/cleanup] Temp recording cleared for event ${evt.id} (${evt.slug})`
      );
    } catch (err) {
      console.error(
        `[cron/cleanup] Failed to clear temp recording for event ${evt.id}:`,
        err
      );
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
      evt.recordingPublishedAt.getTime() + evt.recordingDeleteAfterDays * 86_400_000
    );
    if (expiresAt >= now) continue;

    try {
      // Delete the expired blob (best-effort, outside the transaction).
      if (evt.recordingUrl) {
        await deleteRecordingBlob(evt.recordingUrl).catch(() => false);
      }
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
      console.log(
        `[cron/cleanup] Published recording cleared for event ${evt.id} (${evt.slug})`
      );
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
      recordingPublished: true,
      _count: { select: { registrations: true, questions: true, polls: true } },
    },
  });

  const toClean = expiredEvents.filter((evt) => {
    const retentionExpiry = new Date(
      evt.endsAt.getTime() + evt.dataRetentionDays * 86_400_000
    );
    return retentionExpiry < now;
  });

  let totalRegistrationsDeleted = 0;
  let totalQuestionsDeleted = 0;
  let totalPollsDeleted = 0;
  let eventsProcessed = 0;

  let totalRecordingBlobsDeleted = 0;
  let totalMaterialBlobsDeleted = 0;

  for (const evt of toClean) {
    try {
      // Capture FILE material blob keys BEFORE the transaction deletes the rows,
      // so we can remove the underlying blobs afterwards (network I/O must stay
      // out of the transaction — see the recording deletes below).
      const fileMaterialBlobs = await prisma.eventMaterial.findMany({
        where: { eventId: evt.id, type: 'FILE', blobPath: { not: null } },
        select: { blobPath: true },
      });

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

        // Post-event feedback converged onto the questionnaire subsystem:
        // call-exit feedback now lands in QuestionnaireResponse (which holds
        // a respondent name + email-hash snapshot). The event is only
        // ARCHIVED (never hard-deleted) and registration deletion only
        // SetNulls the FK, so these rows must be purged explicitly or PII
        // would survive past the retention window. Answers cascade.
        const questionnaireResponsesDeleted = await tx.questionnaireResponse.deleteMany({
          where: { questionnaire: { eventId: evt.id } },
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

        // Chat history: sender names + message bodies are PII, encrypted at
        // rest (encryptPII, AES-256-GCM). The FK is onDelete: Cascade, but the
        // event row is only ARCHIVED below (never hard-deleted), so the cascade
        // never fires — these must be purged explicitly or the chat would
        // survive past the retention window.
        const chatMessagesDeleted = await tx.chatMessage.deleteMany({
          where: { eventId: evt.id },
        });

        // Agenda items + their reactions. Reactions tied to a registration
        // already cascaded when the registration was deleted above, but guest
        // reactions and the items themselves are only reachable via the event
        // (never hard-deleted), so purge them explicitly (child before parent).
        const agendaReactionsDeleted = await tx.agendaItemReaction.deleteMany({
          where: { agendaItem: { eventId: evt.id } },
        });
        const agendaItemsDeleted = await tx.eventAgendaItem.deleteMany({
          where: { eventId: evt.id },
        });

        // Per-participant audio track rows (ADR-013). `displayName` is encrypted
        // PII. multitrack-purge already deletes the audio BLOB and stamps
        // audioPurgedAt but never removes the row, so it lingers. Guard on
        // audioPurgedAt: rows whose audio is still present (retained tracks not
        // yet past their own retentionUntil, or a pending ARCHIVE job) are left
        // for a later run — deleting them now would orphan the blob / break the
        // archive. The Recording tree itself is untouched.
        const recordingTracksDeleted = await tx.recordingTrack.deleteMany({
          where: { recording: { eventId: evt.id }, audioPurgedAt: { not: null } },
        });

        // CallSession carries PII in dominantSpeakerLog (encrypted display names)
        // and the participants JSON. We SCRUB rather than delete: a CallSession
        // deletion cascade-kills the whole Recording tree (RecordingTrack /
        // PostprodJob / PostprodArtifact / Speaker), which would violate the AI
        // override retention (Recording.retentionUntil kept as a public record).
        // Scrubbing the two PII JSON columns removes the PII while preserving
        // analytics (peakParticipants, duration) and the postprod graph.
        const callSessionsScrubbed = await tx.callSession.updateMany({
          where: { eventId: evt.id },
          data: { dominantSpeakerLog: [], participants: [] },
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
          questionnaireResponses: questionnaireResponsesDeleted.count,
          wordCloudSubmissions: wcSubmissionsDeleted.count,
          wordCloudRounds: wcRoundsDeleted.count,
          materials: materialsDeleted.count,
          remindersSent: reminderSentDeleted.count,
          reminders: remindersDeleted.count,
          registrations: registrationsDeleted.count,
          chatMessages: chatMessagesDeleted.count,
          agendaReactions: agendaReactionsDeleted.count,
          agendaItems: agendaItemsDeleted.count,
          recordingTracks: recordingTracksDeleted.count,
          callSessionsScrubbed: callSessionsScrubbed.count,
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

      // Blob deletion (network I/O) AFTER the transaction commits — best-effort.
      // tempRecordingUrl is raw pre-publish Jibri output → always safe to purge.
      if (evt.tempRecordingUrl) {
        const ok = await deleteRecordingBlob(evt.tempRecordingUrl).catch(() => false);
        if (ok) totalRecordingBlobsDeleted++;
      }
      // recordingUrl: EXEMPT the PUBLISHED video only. `recordingPublished` is
      // the single "kept public record" signal — the public page shows
      // recordingUrl only when recordingPublished, and the library index also
      // requires it — so its lifetime is governed by recordingDeleteAfterDays
      // (Phase 2), not the PII retention window. Deleting it here would 404 the
      // still-linked player/card. Do NOT also exempt on libraryListed: a
      // library-listed-but-unpublished recording is invisible everywhere, and
      // since Phase 2 only touches published recordings, exempting it here would
      // leak its blob forever.
      if (evt.recordingUrl && !evt.recordingPublished) {
        const ok = await deleteRecordingBlob(evt.recordingUrl).catch(() => false);
        if (ok) totalRecordingBlobsDeleted++;
      }
      if (isAzureConfigured()) {
        for (const m of fileMaterialBlobs) {
          if (m.blobPath) {
            const ok = await deleteBlob(m.blobPath).catch(() => false);
            if (ok) totalMaterialBlobsDeleted++;
          }
        }
      }

      console.log(
        `[cron/cleanup] Cleaned event ${evt.id} (${evt.slug}): ` +
          `${result.registrations} registrations, ${result.questions} questions, ${result.upvotes} upvotes, ${result.polls} polls, ${result.pollVotes} poll votes, ${result.materials} materials, ${result.chatMessages} chat messages deleted`
      );

      totalRegistrationsDeleted += result.registrations;
      totalQuestionsDeleted += result.questions;
      totalPollsDeleted += result.polls;
      eventsProcessed++;
    } catch (err) {
      console.error(`[cron/cleanup] Failed to clean event ${evt.id} (${evt.slug}):`, err);
    }
  }

  return Response.json({
    ok: true,
    tempRecordingsCleaned: tempRecordingEvents.length,
    publishedRecordingsCleaned: recordingRetentionEvents.filter((evt) => {
      if (!evt.recordingPublishedAt || !evt.recordingDeleteAfterDays) return false;
      const expiresAt = new Date(
        evt.recordingPublishedAt.getTime() + evt.recordingDeleteAfterDays * 86_400_000
      );
      return expiresAt < now;
    }).length,
    eventsProcessed,
    registrationsDeleted: totalRegistrationsDeleted,
    questionsDeleted: totalQuestionsDeleted,
    pollsDeleted: totalPollsDeleted,
    recordingBlobsDeleted: totalRecordingBlobsDeleted,
    materialBlobsDeleted: totalMaterialBlobsDeleted,
  });
});
