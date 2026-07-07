/**
 * Post-event follow-up emails (opt-in per event).
 *
 * Invoked from the reminders cron (no dedicated CronJob). For each ENDED event
 * that opted in and hasn't been finalized yet, it ensures the recap exists,
 * emails every registrant a thank-you + recap/feedback link, and emails the
 * moderator a short recap.
 *
 * Idempotency: the event is CLAIMED (postEventEmailSentAt set) with a guarded
 * updateMany BEFORE any email is enqueued, so two overlapping cron runs can't
 * double-send. enqueueEmail is durable (writes the outbox row), so claiming
 * first is safe — the actual SMTP send + retry is the email-outbox cron's job.
 */

import { decryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { enqueueEmail } from '@/lib/email/outbox';
import {
  postEventParticipantEmail,
  postEventModeratorEmail,
} from '@/lib/email/templates';
import { ensureEventRecap, formatRecapSummary } from '@/lib/events/recap';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { localizedUrl } from '@/lib/utils/localized-url';

// Don't retroactively email events that ended long before the opt-in was
// flipped on: only finalize events that ended within this window.
const MAX_AGE_DAYS = 7;

export async function finalizePostEventEmails(opts: {
  now: Date;
  baseUrl: string;
  siteName: string;
}): Promise<{ eventsFinalized: number; emailsSent: number; emailsFailed: number }> {
  const { now, baseUrl, siteName } = opts;
  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000);
  const locale: 'it' | 'en' = 'it';

  const events = await prisma.event.findMany({
    where: {
      status: 'ENDED',
      postEventEmailEnabled: true,
      postEventEmailSentAt: null,
      endsAt: { gte: cutoff },
      eventType: { not: 'LEGACY' },
    },
    select: {
      id: true,
      slug: true,
      title: true,
      moderatorEmail: true,
      recordingPublished: true,
      recordingUrl: true,
    },
  });

  let eventsFinalized = 0;
  let emailsSent = 0;
  let emailsFailed = 0;

  for (const event of events) {
    // Claim first: atomic guard against a concurrent run double-sending.
    const claim = await prisma.event.updateMany({
      where: { id: event.id, postEventEmailSentAt: null },
      data: { postEventEmailSentAt: now },
    });
    if (claim.count === 0) continue;
    eventsFinalized++;

    const title = getLocalized(event.title as LocalizedField, locale);
    const eventPageUrl = localizedUrl(baseUrl, `/events/${event.slug}`, locale);

    // Ensure the recap exists (covers events nobody opened) for the summary.
    const recap = await ensureEventRecap(event.id);
    const recapSummary = recap ? formatRecapSummary(recap, locale) : '';

    // Participant thank-you + recap/feedback link.
    const registrations = await prisma.registration.findMany({
      where: { eventId: event.id },
      select: { id: true, email: true },
    });
    for (const reg of registrations) {
      try {
        const to = decryptPII(reg.email);
        const mail = postEventParticipantEmail({
          locale,
          eventTitle: title,
          eventPageUrl,
          siteName,
        });
        await enqueueEmail({
          to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          metadata: {
            kind: 'post_event_participant',
            eventId: event.id,
            registrationId: reg.id,
          },
        });
        emailsSent++;
      } catch (err) {
        console.error(
          `[post-event-finalize] participant email failed (event ${event.id}, reg ${reg.id}):`,
          err,
        );
        emailsFailed++;
      }
    }

    // Moderator recap.
    const moderatorEmail = tryDecryptPII(event.moderatorEmail);
    if (moderatorEmail) {
      try {
        const mail = postEventModeratorEmail({
          locale,
          eventTitle: title,
          eventPageUrl,
          siteName,
          recapSummary,
          recordingUrl: event.recordingPublished ? event.recordingUrl : null,
        });
        await enqueueEmail({
          to: moderatorEmail,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          metadata: { kind: 'post_event_moderator', eventId: event.id },
        });
        emailsSent++;
      } catch (err) {
        console.error(
          `[post-event-finalize] moderator email failed (event ${event.id}):`,
          err,
        );
        emailsFailed++;
      }
    }
  }

  return { eventsFinalized, emailsSent, emailsFailed };
}
