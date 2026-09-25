import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { decryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { enqueueEmail } from '@/lib/email/outbox';
import { getSettings } from '@/lib/settings';
import {
  absoluteEventImage,
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
import { WARMUP_STATUSES } from '@/lib/events/visibility';
import { finalizePostEventEmails } from '@/lib/events/post-event-finalize';
import { localizedUrl } from '@/lib/utils/localized-url';
import { registrationJoinUrl } from '@/lib/events/registration-link';

export const dynamic = 'force-dynamic';

import { lingueIscrizione } from '@/lib/email/lingua';

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
        // PROVISIONING/IDLE inclusi: lo scaler mette l'evento in pre-warm
        // PRIMA dell'inizio (anche overnight) — è esattamente la finestra
        // in cui i reminder T-1h/T-10m devono partire, non essere saltati.
        // (Il filtro dueReminders sotto richiede startsAt futuro, quindi un
        // evento incagliato in IDLE dopo la fine non riceve comunque nulla.)
        status: { in: ['PUBLISHED', 'LIVE', ...WARMUP_STATUSES] },
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

  const overridePerLingua = new Map<string, Awaited<ReturnType<typeof loadEmailTemplateOverride>>>();
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

    for (const reg of registrations) {
      try {
        // Ognuno nella lingua in cui si e' iscritto: link e titolo in quella
        // della pagina, testi nella lingua email corrispondente.
        const { pagina: locale, testi } = lingueIscrizione(reg.locale, settings.defaultLocale);
        const title = getLocalized(event.title as LocalizedField, locale);
        const description = getLocalized(event.description as LocalizedField, locale);
        const recipientEmail = decryptPII(reg.email);
        // Con l'iscrizione pubblica spenta il link dell'email e' anche la
        // prova d'identita' (lib/events/registration-link).
        const joinUrl = registrationJoinUrl({
          baseUrl,
          slug: event.slug,
          eventId: event.id,
          accessToken: reg.accessToken,
          locale,
          viaEmailEntry: !settings.publicRegistrationEnabled,
        });
        const eventPageUrl = localizedUrl(baseUrl, `/events/${event.slug}`, locale);

        // Negli eventi di calendario il link della sala, senza firma: si
        // inoltrano e si condividono, e non devono portare l'identita'.
        const calendarInput = {
          title,
          description,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          joinUrl: registrationJoinUrl({
            baseUrl,
            slug: event.slug,
            eventId: event.id,
            accessToken: reg.accessToken,
            locale,
            viaEmailEntry: false,
          }),
        };

        const templateInput = {
          locale: testi,
          eventTitle: title,
          eventDate: formatDate(event.startsAt, testi, event.timezone),
          eventTime: formatTime(event.startsAt, testi, event.timezone),
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
          eventImageUrl: absoluteEventImage(event, baseUrl),
        };

        const icsContent = generateEventICal({
          title,
          description,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          timezone: event.timezone,
          url: eventPageUrl,
          organizerName: event.moderatorName ?? (settings.siteName || 'PA Webinar'),
          organizerEmail:
            tryDecryptPII(event.moderatorEmail) ??
            process.env.SMTP_FROM ??
            'noreply@dominio.gov.it',
        });

        // Una lettura per lingua, non una per iscritto.
        let override = overridePerLingua.get(testi);
        if (override === undefined) {
          override = await loadEmailTemplateOverride('reminder', testi);
          overridePerLingua.set(testi, override);
        }
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
            siteName: settings.siteName || 'PA Webinar',
            offsetMinutes: reminder.offsetMinutes,
          },
        );

        await enqueueEmail({
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
          metadata: {
            kind: 'reminder',
            reminderId: reminder.id,
            registrationId: reg.id,
            eventId: reminder.eventId,
          },
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

  // Post-event follow-up emails (opt-in). Same cadence as reminders, so no
  // dedicated CronJob is needed; the helper is idempotent (claims each event
  // before sending).
  const postEvent = await finalizePostEventEmails({
    now,
    baseUrl,
    siteName: settings.siteName || 'PA Webinar',
    defaultLocale: settings.defaultLocale,
  });

  return Response.json({
    ok: true,
    remindersProcessed,
    emailsSent,
    emailsFailed,
    postEvent,
  });
});
