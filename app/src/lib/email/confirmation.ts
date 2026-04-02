/**
 * Fire-and-forget confirmation email sender.
 * Called after a successful registration — must never block the API response.
 */

import { prisma } from '@/lib/db';
import { decryptPII } from '@/lib/crypto/pii';
import { generateEventICal } from '@/lib/ical/generate';
import {
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  generateYahooCalendarUrl,
  generateIcsDownloadUrl,
} from '@/lib/ical/calendar-links';
import { sendEmail } from '@/lib/email/send';
import {
  confirmationSubject,
  confirmationHtml,
  confirmationText,
} from '@/lib/email/templates';
import { formatDate, formatTime, formatDuration } from '@/lib/utils/date-format';
import { getPublicEnv } from '@/lib/env';

type Locale = 'it' | 'en';

interface ConfirmationEmailInput {
  registrationId: string;
  locale: Locale;
  joinUrl: string;
  eventPageUrl: string;
}

/**
 * Send the confirmation email with iCal attachment.
 * Fire-and-forget: errors are logged but never thrown to the caller.
 */
export function sendConfirmationEmail(input: ConfirmationEmailInput): void {
  void (async () => {
    try {
      const registration = await prisma.registration.findUnique({
        where: { id: input.registrationId },
        include: { event: true },
      });

      if (!registration) return;

      const event = registration.event;
      const recipientEmail = decryptPII(registration.email);
      const title =
        input.locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;
      const description =
        input.locale === 'en' && event.descriptionEn
          ? event.descriptionEn
          : event.descriptionIt;

      const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
      const calendarInput = {
        title,
        description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        joinUrl: input.joinUrl,
      };

      const templateInput = {
        locale: input.locale,
        eventTitle: title,
        eventDate: formatDate(event.startsAt, input.locale),
        eventTime: formatTime(event.startsAt, input.locale),
        eventDuration: formatDuration(event.startsAt, event.endsAt),
        joinUrl: input.joinUrl,
        eventPageUrl: input.eventPageUrl,
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
        url: input.eventPageUrl,
        organizerName: event.moderatorName ?? 'Eventi DTD',
        organizerEmail: event.moderatorEmail ?? process.env.SMTP_FROM ?? 'noreply@dominio.gov.it',
      });

      await sendEmail({
        to: recipientEmail,
        subject: confirmationSubject(input.locale, title),
        html: confirmationHtml(templateInput),
        text: confirmationText(templateInput),
        attachments: [
          {
            filename: 'event.ics',
            content: icsContent,
            contentType: 'text/calendar; charset=utf-8; method=REQUEST',
          },
        ],
      });

      await prisma.registration.update({
        where: { id: input.registrationId },
        data: { confirmationSentAt: new Date() },
      });
    } catch (err) {
      console.error('[email] Failed to send confirmation email:', err);
    }
  })();
}
