/**
 * Confirmation email sender.
 *
 * Called after a successful registration. Enqueues an EmailOutbox row
 * synchronously (single DB insert) and lets the outbox cron deliver
 * via the pooled SMTP transport. The API route is no longer coupled
 * to SMTP latency, and if the pod restarts the mail survives in
 * Postgres.
 */

import { prisma } from '@/lib/db';
import { decryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { generateEventICal } from '@/lib/ical/generate';
import {
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  generateYahooCalendarUrl,
  generateIcsDownloadUrl,
} from '@/lib/ical/calendar-links';
import { enqueueEmail } from '@/lib/email/outbox';
import {
  absoluteEventImage,
  confirmationHtml,
  confirmationText,
  baseConfirmationCopy,
} from '@/lib/email/templates';
import {
  applyOverride,
  loadEmailTemplateOverride,
} from '@/lib/email/resolve-template';
import { formatDate, formatTime, formatDuration } from '@/lib/utils/date-format';
import { getPublicEnv } from '@/lib/env';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

type Locale = 'it' | 'en';

interface ConfirmationEmailInput {
  registrationId: string;
  locale: Locale;
  joinUrl: string;
  eventPageUrl: string;
  siteName?: string;
  organizationFooter?: string;
}

/**
 * Enqueue the confirmation email with iCal attachment into EmailOutbox.
 *
 * Synchronous (single DB insert). Errors are logged and swallowed so
 * the caller's happy path (API 201 response) is never blocked.
 *
 * `confirmationSentAt` is set to the enqueue time — from the user's
 * perspective the system has accepted responsibility for delivery.
 * Actual SMTP status lives in EmailOutbox.status.
 */
export async function sendConfirmationEmail(input: ConfirmationEmailInput): Promise<void> {
  try {
    const registration = await prisma.registration.findUnique({
      where: { id: input.registrationId },
      include: { event: true },
    });

    if (!registration) return;

    const event = registration.event;
    const recipientEmail = decryptPII(registration.email);
    const title = getLocalized(event.title as LocalizedField, input.locale);
    const description = getLocalized(event.description as LocalizedField, input.locale);

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
      eventDate: formatDate(event.startsAt, input.locale, event.timezone),
      eventTime: formatTime(event.startsAt, input.locale, event.timezone),
      eventDuration: formatDuration(event.startsAt, event.endsAt),
      joinUrl: input.joinUrl,
      eventPageUrl: input.eventPageUrl,
      calendarLinks: {
        google: generateGoogleCalendarUrl(calendarInput),
        outlook: generateOutlookCalendarUrl(calendarInput),
        yahoo: generateYahooCalendarUrl(calendarInput),
        icsDownload: generateIcsDownloadUrl(event.slug, baseUrl),
      },
      siteName: input.siteName,
      organizationFooter: input.organizationFooter,
      // Banner dell'evento in cima all'email (l'immagine c'era sulla pagina
      // pubblica ma non è mai arrivata in posta).
      eventImageUrl: absoluteEventImage(event, baseUrl),
    };

    const icsContent = generateEventICal({
      title,
      description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      url: input.eventPageUrl,
      organizerName: event.moderatorName ?? 'PA Webinar',
      // moderatorEmail is stored AES-256-GCM encrypted — decrypt it before it
      // becomes the iCal ORGANIZER mailto, otherwise calendar clients receive
      // base64 ciphertext as the organizer address. (tryDecryptPII returns the
      // decrypted email, leaves legacy plaintext as-is, and yields null only
      // when the value is absent — so SMTP_FROM is the fallback for no organizer.)
      organizerEmail:
        tryDecryptPII(event.moderatorEmail) ?? process.env.SMTP_FROM ?? 'noreply@dominio.gov.it',
    });

    const override = await loadEmailTemplateOverride('confirmation', input.locale);
    const resolved = applyOverride(
      baseConfirmationCopy(templateInput),
      override,
      {
        eventTitle: templateInput.eventTitle,
        eventDate: templateInput.eventDate,
        eventTime: templateInput.eventTime,
        eventDuration: templateInput.eventDuration,
        joinUrl: templateInput.joinUrl,
        eventPageUrl: templateInput.eventPageUrl,
        siteName: templateInput.siteName,
      },
    );

    await enqueueEmail({
      to: recipientEmail,
      subject: resolved.subject,
      html: confirmationHtml(templateInput, resolved),
      text: confirmationText(templateInput, resolved),
      attachments: [
        {
          filename: 'event.ics',
          content: icsContent,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        },
      ],
      metadata: {
        kind: 'confirmation',
        registrationId: input.registrationId,
        eventId: event.id,
        locale: input.locale,
      },
    });

    await prisma.registration.update({
      where: { id: input.registrationId },
      data: { confirmationSentAt: new Date() },
    });
  } catch (err) {
    console.error('[email] Failed to enqueue confirmation email:', err);
  }
}
