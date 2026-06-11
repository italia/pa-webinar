/**
 * Date-change notification email for registered participants.
 * Sent when a moderator updates the event date on a PUBLISHED event.
 */

import { prisma } from '@/lib/db';
import { decryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { generateEventICal } from '@/lib/ical/generate';
import { enqueueEmail } from '@/lib/email/outbox';
import { formatDate, formatTime } from '@/lib/utils/date-format';
import { getPublicEnv } from '@/lib/env';
import { localizedUrl } from '@/lib/utils/localized-url';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

type Locale = 'it' | 'en';

interface DateChangeNotificationInput {
  eventId: string;
  locale: Locale;
}

const COPY = {
  it: {
    subject: (title: string) => `Aggiornamento: ${title} — Nuova data`,
    heading: 'Data evento aggiornata',
    body: 'La data dell\'evento a cui sei registrato è stata modificata.',
    newDate: 'Nuova data',
    newTime: 'Nuovo orario',
    linkNote: 'Il tuo link personale per partecipare resta invariato.',
    footer: 'Questa email è stata inviata automaticamente da PA Webinar.',
  },
  en: {
    subject: (title: string) => `Update: ${title} — New date`,
    heading: 'Event date updated',
    body: 'The date for the event you registered for has been changed.',
    newDate: 'New date',
    newTime: 'New time',
    linkNote: 'Your personal join link remains unchanged.',
    footer: 'This email was sent automatically by PA Webinar.',
  },
} as const;

function notificationHtml(locale: Locale, title: string, date: string, time: string): string {
  const c = COPY[locale];
  return `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><title>${c.subject(title)}</title></head>
<body style="margin:0;padding:0;font-family:'Titillium Web',Arial,sans-serif;background:#f5f7fb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;margin-top:24px;">
    <tr><td style="background:#0066CC;padding:24px 32px;"><h1 style="color:#fff;margin:0;font-size:22px;">${c.heading}</h1></td></tr>
    <tr><td style="padding:32px;">
      <p style="font-size:16px;color:#17324D;line-height:1.6;">${c.body}</p>
      <table role="presentation" style="width:100%;margin:16px 0 24px;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#5A768A;text-transform:uppercase;width:130px;">${c.newDate}</td>
          <td style="padding:8px 0;font-size:15px;color:#17324D;font-weight:600;">${date}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#5A768A;text-transform:uppercase;">${c.newTime}</td>
          <td style="padding:8px 0;font-size:15px;color:#17324D;font-weight:600;">${time}</td>
        </tr>
      </table>
      <p style="font-size:14px;color:#455B71;line-height:1.5;">${c.linkNote}</p>
    </td></tr>
    <tr><td style="padding:16px 32px;background:#f5f7fb;text-align:center;">
      <p style="margin:0;font-size:12px;color:#5A768A;">${c.footer}</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function notificationText(locale: Locale, title: string, date: string, time: string): string {
  const c = COPY[locale];
  return `${c.heading}\n\n${c.body}\n\n${c.newDate}: ${date}\n${c.newTime}: ${time}\n\n${c.linkNote}\n\n---\n${c.footer}`;
}

/**
 * Send date-change notifications to all registered participants.
 * Fire-and-forget: errors are logged but never thrown.
 */
export function sendDateChangeNotifications(input: DateChangeNotificationInput): void {
  void (async () => {
    try {
      const event = await prisma.event.findUnique({
        where: { id: input.eventId },
        include: { registrations: true },
      });

      if (!event || event.registrations.length === 0) return;

      const title = getLocalized(event.title as LocalizedField, input.locale);
      const description = getLocalized(event.description as LocalizedField, input.locale);
      const date = formatDate(event.startsAt, input.locale, event.timezone);
      const time = formatTime(event.startsAt, input.locale, event.timezone);

      const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
      const eventPageUrl = localizedUrl(baseUrl, `/events/${event.slug}`, input.locale);

      const icsContent = generateEventICal({
        title,
        description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        url: eventPageUrl,
        organizerName: event.moderatorName ?? 'PA Webinar',
        // moderatorEmail is stored AES-256-GCM encrypted — decrypt before it
        // becomes the iCal ORGANIZER mailto (otherwise calendar clients get
        // base64 ciphertext). Mirrors confirmation.ts / calendar.ics.
        organizerEmail:
          tryDecryptPII(event.moderatorEmail) ?? process.env.SMTP_FROM ?? 'noreply@dominio.gov.it',
      });

      const subject = COPY[input.locale].subject(title);
      const html = notificationHtml(input.locale, title, date, time);
      const text = notificationText(input.locale, title, date, time);

      for (const registration of event.registrations) {
        try {
          const recipientEmail = decryptPII(registration.email);
          await enqueueEmail({
            to: recipientEmail,
            subject,
            html,
            text,
            attachments: [{
              filename: 'event-updated.ics',
              content: icsContent,
              contentType: 'text/calendar; charset=utf-8; method=REQUEST',
            }],
            metadata: {
              kind: 'date-change-notification',
              registrationId: registration.id,
              eventId: input.eventId,
              locale: input.locale,
            },
          });
        } catch (err) {
          console.error(`[email] Failed to enqueue date-change notification for registration ${registration.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[email] Failed to send date-change notifications:', err);
    }
  })();
}
