import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { decryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { getSettings } from '@/lib/settings';
import {
  reminderHtml,
  reminderText,
  baseReminderCopy,
} from '@/lib/email/templates';
import {
  applyOverride,
  loadEmailTemplateOverride,
} from '@/lib/email/resolve-template';
import {
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  generateYahooCalendarUrl,
  generateIcsDownloadUrl,
} from '@/lib/ical/calendar-links';
import { generateEventICal } from '@/lib/ical/generate';
import { formatDate, formatTime, formatDuration } from '@/lib/utils/date-format';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { getPublicEnv } from '@/lib/env';
import { localizedUrl } from '@/lib/utils/localized-url';

export const dynamic = 'force-dynamic';

type Locale = 'it' | 'en';

/**
 * GET /api/cron/reminders
 *
 * Configurable reminder system. For each EventReminder:
 *   - Check if event.startsAt - offsetMinutes <= NOW()
 *   - Find registrations that don't have a ReminderSent entry for this reminder
 *   - Send reminder email, create ReminderSent record
 *
 * Protected by CRON_API_KEY.
 * In production, called by a Kubernetes CronJob every 5 minutes.
 */
export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const now = new Date();

  const reminders = await prisma.eventReminder.findMany({
    where: {
      event: {
        status: { in: ['PUBLISHED', 'LIVE'] },
      },
    },
    include: {
      event: true,
    },
  });

  const dueReminders = reminders.filter((r) => {
    const triggerAt = new Date(r.event.startsAt.getTime() - r.offsetMinutes * 60_000);
    return triggerAt <= now && r.event.startsAt > now;
  });

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const settings = await getSettings();
  let remindersProcessed = 0;
  let emailsSent = 0;
  let emailsFailed = 0;

  for (const reminder of dueReminders) {
    const event = reminder.event;

    const registrations = await prisma.registration.findMany({
      where: {
        eventId: event.id,
        remindersSent: {
          none: { reminderId: reminder.id },
        },
      },
    });

    if (registrations.length === 0) continue;
    remindersProcessed++;

    const locale: Locale = 'it';
    const title = getLocalized(event.title as LocalizedField, locale);
    const description = getLocalized(event.description as LocalizedField, locale);

    for (const reg of registrations) {
      try {
        const recipientEmail = decryptPII(reg.email);
        const joinUrl = localizedUrl(baseUrl, `/events/${event.slug}/live?token=${reg.accessToken}`, locale);
        const eventPageUrl = localizedUrl(baseUrl, `/events/${event.slug}`, locale);

        const calendarInput = {
          title,
          description,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          joinUrl,
        };

        const templateInput = {
          locale,
          eventTitle: title,
          eventDate: formatDate(event.startsAt, locale, event.timezone),
          eventTime: formatTime(event.startsAt, locale, event.timezone),
          eventDuration: formatDuration(event.startsAt, event.endsAt),
          joinUrl,
          eventPageUrl,
          offsetMinutes: reminder.offsetMinutes,
          calendarLinks: {
            google: generateGoogleCalendarUrl(calendarInput),
            outlook: generateOutlookCalendarUrl(calendarInput),
            yahoo: generateYahooCalendarUrl(calendarInput),
            icsDownload: generateIcsDownloadUrl(event.slug, baseUrl),
          },
        };

        const icsContent = generateEventICal({
          title,
          description,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          timezone: event.timezone,
          url: eventPageUrl,
          organizerName: event.moderatorName ?? (settings.siteName || 'Eventi PA'),
          organizerEmail:
            event.moderatorEmail ??
            process.env.SMTP_FROM ??
            'noreply@dominio.gov.it',
        });

        const override = await loadEmailTemplateOverride('reminder', locale);
        const resolved = applyOverride(
          baseReminderCopy(templateInput),
          override,
          {
            eventTitle: templateInput.eventTitle,
            eventDate: templateInput.eventDate,
            eventTime: templateInput.eventTime,
            eventDuration: templateInput.eventDuration,
            joinUrl: templateInput.joinUrl,
            eventPageUrl: templateInput.eventPageUrl,
            siteName: settings.siteName || 'Eventi PA',
            offsetMinutes: reminder.offsetMinutes,
          },
        );

        await sendEmail({
          to: recipientEmail,
          subject: resolved.subject,
          html: reminderHtml(templateInput, resolved),
          text: reminderText(templateInput, resolved),
          attachments: [
            {
              filename: 'event.ics',
              content: icsContent,
              contentType: 'text/calendar; charset=utf-8; method=REQUEST',
            },
          ],
        });

        await prisma.reminderSent.create({
          data: {
            reminderId: reminder.id,
            registrationId: reg.id,
          },
        });

        emailsSent++;
      } catch (err) {
        console.error(
          `[cron/reminders] Failed to send reminder ${reminder.id} to registration ${reg.id}:`,
          err,
        );
        emailsFailed++;
      }
    }
  }

  return Response.json({
    ok: true,
    remindersProcessed,
    emailsSent,
    emailsFailed,
  });
});
