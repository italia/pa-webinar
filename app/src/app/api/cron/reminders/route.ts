import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { decryptPII } from '@/lib/crypto/pii';
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
import { generateEventICal, ICS_ATTACHMENT_CONTENT_TYPE } from '@/lib/ical/generate';
import { formatDate, formatTime, formatDuration } from '@/lib/utils/date-format';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { getPublicEnv } from '@/lib/env';
import { WARMUP_STATUSES } from '@/lib/events/visibility';
import { finalizePostEventEmails } from '@/lib/events/post-event-finalize';
import { localizedUrl } from '@/lib/utils/localized-url';
import { registrationJoinUrl } from '@/lib/events/registration-link';
import { currentReminder } from '@/lib/email/reminder-plan';
import { rubricaOptOutUrl } from '@/lib/persons/opt-out-link';

export const dynamic = 'force-dynamic';

import { lingueIscrizione } from '@/lib/email/lingua';

/**
 * GET /api/cron/reminders
 *
 * Configurable reminder system. For each event that has not started, only
 * its CURRENT reminder counts: the due one (startsAt - offsetMinutes <= NOW())
 * with the smallest offset (lib/email/reminder-plan). Larger due reminders are
 * superseded and never go out, so an overdue "starts tomorrow" is never sent
 * minutes before the start. The current reminder goes to every registration
 * created by its trigger time that has no ReminderSent row for it; a reminder
 * created after its own trigger time (event created less than a day ahead)
 * goes to nobody. At most one reminder per registrant per run.
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
        // (Il filtro dei promemoria scattati sotto richiede startsAt futuro, quindi un
        // evento incagliato in IDLE dopo la fine non riceve comunque nulla.)
        status: { in: ['PUBLISHED', 'LIVE', ...WARMUP_STATUSES] },
      },
    },
    include: {
      event: true,
    },
  });

  // Per evento conta solo il promemoria CORRENTE: quello scattato con
  // l'anticipo minore (lib/email/reminder-plan). Gli altri scattati sono
  // superati e non partono piu'.
  const perEvento = new Map<string, typeof reminders>();
  for (const r of reminders) {
    const lista = perEvento.get(r.eventId) ?? [];
    lista.push(r);
    perEvento.set(r.eventId, lista);
  }

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const settings = await getSettings();
  let remindersProcessed = 0;
  let emailsSent = 0;
  let emailsFailed = 0;

  const overridePerLingua = new Map<string, Awaited<ReturnType<typeof loadEmailTemplateOverride>>>();
  for (const promemoria of perEvento.values()) {
    const event = promemoria[0]!.event;
    const corrente = currentReminder(promemoria, event.startsAt, now);
    if (!corrente) continue;
    const { reminder, registeredBy } = corrente;

    // Chi era gia' iscritto quando il promemoria e' scattato e non l'ha
    // ancora ricevuto. Chi si e' iscritto dopo ha appena avuto la conferma.
    const registrations = await prisma.registration.findMany({
      where: {
        eventId: event.id,
        createdAt: { lte: registeredBy },
        remindersSent: { none: { reminderId: reminder.id } },
      },
      include: {
        // Chi e' entrato in rubrica riceve il link per uscirne.
        person: { select: { id: true, optedInToAddressBook: true } },
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
          addressBookOptOutUrl: rubricaOptOutUrl(reg.person, baseUrl, locale),
        };

        // Stesso UID della conferma: il promemoria aggiorna la voce di
        // calendario gia' importata invece di aggiungerne un'altra.
        const icsContent = generateEventICal({
          eventId: event.id,
          updatedAt: event.updatedAt,
          title,
          description,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          timezone: event.timezone,
          url: eventPageUrl,
          organizerName: event.moderatorName ?? (settings.siteName || 'PA Webinar'),
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
              contentType: ICS_ATTACHMENT_CONTENT_TYPE,
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
