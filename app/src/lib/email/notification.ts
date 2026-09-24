/**
 * Date-change notification email for registered participants.
 * Sent when a moderator updates the event date on a PUBLISHED event.
 */

import { prisma } from '@/lib/db';
import { decryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { generateEventICal } from '@/lib/ical/generate';
import { enqueueEmail } from '@/lib/email/outbox';
import { lingueIscrizione } from '@/lib/email/lingua';
import { getSettings } from '@/lib/settings';
import { formatDate, formatTime } from '@/lib/utils/date-format';
import { getPublicEnv } from '@/lib/env';
import { localizedUrl } from '@/lib/utils/localized-url';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import type { EmailLocale } from '@/lib/email/lingua';

type Locale = EmailLocale;

interface DateChangeNotificationInput {
  eventId: string;
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
  fr: {
    subject: (title: string) => `Mise à jour : ${title} — Nouvelle date`,
    heading: 'Date de l’événement modifiée',
    body: 'La date de l’événement auquel vous êtes inscrit a été modifiée.',
    newDate: 'Nouvelle date',
    newTime: 'Nouvel horaire',
    linkNote: 'Votre lien personnel pour participer reste inchangé.',
    footer: 'Cet e-mail a été envoyé automatiquement par PA Webinar.',
  },
  de: {
    subject: (title: string) => `Aktualisierung: ${title} — Neues Datum`,
    heading: 'Datum der Veranstaltung geändert',
    body: 'Das Datum der Veranstaltung, für die Sie angemeldet sind, wurde geändert.',
    newDate: 'Neues Datum',
    newTime: 'Neue Uhrzeit',
    linkNote: 'Ihr persönlicher Teilnahmelink bleibt unverändert.',
    footer: 'Diese E-Mail wurde automatisch von PA Webinar versendet.',
  },
  es: {
    subject: (title: string) => `Actualización: ${title} — Nueva fecha`,
    heading: 'Fecha del evento actualizada',
    body: 'Se ha modificado la fecha del evento en el que está inscrito.',
    newDate: 'Nueva fecha',
    newTime: 'Nuevo horario',
    linkNote: 'Su enlace personal para participar no cambia.',
    footer: 'Este correo electrónico ha sido enviado automáticamente por PA Webinar.',
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

      const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
      const { defaultLocale: predefinita } = await getSettings();

      // Ognuno nella lingua in cui si e' iscritto: testi, titolo, data e
      // link. Il contenuto si prepara una volta per lingua.
      const perLingua = new Map<string, { subject: string; html: string; text: string; ics: string }>();
      const contenuto = (pagina: string, testi: Locale) => {
        const chiave = `${pagina}|${testi}`;
        const pronto = perLingua.get(chiave);
        if (pronto) return pronto;
        const title = getLocalized(event.title as LocalizedField, pagina);
        const description = getLocalized(event.description as LocalizedField, pagina);
        const date = formatDate(event.startsAt, testi, event.timezone);
        const time = formatTime(event.startsAt, testi, event.timezone);
        const eventPageUrl = localizedUrl(baseUrl, `/events/${event.slug}`, pagina);
        const ics = generateEventICal({
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
        const nuovo = {
          subject: COPY[testi].subject(title),
          html: notificationHtml(testi, title, date, time),
          text: notificationText(testi, title, date, time),
          ics,
        };
        perLingua.set(chiave, nuovo);
        return nuovo;
      };

      for (const registration of event.registrations) {
        try {
          const { pagina, testi } = lingueIscrizione(registration.locale, predefinita);
          const mail = contenuto(pagina, testi);
          const recipientEmail = decryptPII(registration.email);
          await enqueueEmail({
            to: recipientEmail,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            attachments: [{
              filename: 'event-updated.ics',
              content: mail.ics,
              contentType: 'text/calendar; charset=utf-8; method=REQUEST',
            }],
            metadata: {
              kind: 'date-change-notification',
              registrationId: registration.id,
              eventId: input.eventId,
              locale: testi,
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
