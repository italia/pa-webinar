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
import { decryptPII } from '@/lib/crypto/pii';
import { generateEventICal, ICS_ATTACHMENT_CONTENT_TYPE } from '@/lib/ical/generate';
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
import { linguaEmail } from '@/lib/email/lingua';
import { rubricaOptOutUrl } from '@/lib/persons/opt-out-link';

interface ConfirmationEmailInput {
  registrationId: string;
  /** La lingua della pagina di chi si e' iscritto: titolo e link la seguono;
   *  i testi dell'email sono nella lingua email corrispondente. */
  locale: string;
  joinUrl: string;
  /** Il link per gli eventi di calendario, se diverso da `joinUrl`: un evento
   *  di calendario si inoltra e si condivide, e non deve portare con sé la
   *  prova d'identità del link dell'email (lib/events/registration-link). */
  calendarJoinUrl?: string;
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
      include: {
        event: true,
        // Chi e' entrato in rubrica riceve il link per uscirne.
        person: { select: { id: true, optedInToAddressBook: true } },
      },
    });

    if (!registration) return;

    const event = registration.event;
    const recipientEmail = decryptPII(registration.email);
    const testi = linguaEmail(input.locale);
    const title = getLocalized(event.title as LocalizedField, input.locale);
    const description = getLocalized(event.description as LocalizedField, input.locale);

    const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
    const calendarInput = {
      title,
      description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      joinUrl: input.calendarJoinUrl ?? input.joinUrl,
    };

    const templateInput = {
      locale: testi,
      eventTitle: title,
      eventDate: formatDate(event.startsAt, testi, event.timezone),
      eventTime: formatTime(event.startsAt, testi, event.timezone),
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
      addressBookOptOutUrl: rubricaOptOutUrl(registration.person, baseUrl, input.locale),
    };

    // UID stabile e SEQUENCE dall'ultima modifica: la conferma, i promemoria e
    // l'avviso di cambio data aggiornano la stessa voce di calendario.
    const icsContent = generateEventICal({
      eventId: event.id,
      updatedAt: event.updatedAt,
      title,
      description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      url: input.eventPageUrl,
      organizerName: event.moderatorName ?? 'PA Webinar',
    });

    const override = await loadEmailTemplateOverride('confirmation', testi);
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
          contentType: ICS_ATTACHMENT_CONTENT_TYPE,
        },
      ],
      metadata: {
        kind: 'confirmation',
        registrationId: input.registrationId,
        eventId: event.id,
        locale: testi,
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
