import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { constantTimeEqual } from '@/lib/auth/moderator';
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
  reminderSubject,
  reminderHtml,
  reminderText,
} from '@/lib/email/templates';
import { formatDate, formatTime, formatDuration } from '@/lib/utils/date-format';

export const dynamic = 'force-dynamic';

type Locale = 'it' | 'en';

/**
 * GET /api/cron/reminders
 *
 * Finds events starting within 60 minutes that have registrations
 * without reminderSentAt, and sends reminder emails.
 * Protected by CRON_API_KEY.
 *
 * In production, called by a Kubernetes CronJob every 15 minutes.
 */
export async function GET(request: Request) {
  const apiKey = process.env.CRON_API_KEY;
  const providedKey = request.headers.get('x-api-key') ?? '';

  if (!apiKey || !constantTimeEqual(providedKey, apiKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const sixtyMinutesFromNow = new Date(now.getTime() + 60 * 60_000);

  const events = await prisma.event.findMany({
    where: {
      status: { in: ['PUBLISHED', 'LIVE'] },
      startsAt: { gt: now, lte: sixtyMinutesFromNow },
    },
    include: {
      registrations: {
        where: { reminderSentAt: null },
      },
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  let sent = 0;
  let failed = 0;

  for (const event of events) {
    // NOTE: Registration does not store user locale preference.
    // Default to Italian as primary locale per ADR-008.
    // Future improvement: store locale at registration time.
    const locale: Locale = 'it';
    const title = event.titleIt;
    const description = event.descriptionIt;

    for (const reg of event.registrations) {
      try {
        const recipientEmail = decryptPII(reg.email);

        const joinUrl = `${baseUrl}/${locale}/eventi/${event.slug}/live?token=${reg.accessToken}`;
        const eventPageUrl = `${baseUrl}/${locale}/eventi/${event.slug}`;

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
          eventDate: formatDate(event.startsAt, locale),
          eventTime: formatTime(event.startsAt, locale),
          eventDuration: formatDuration(event.startsAt, event.endsAt),
          joinUrl,
          eventPageUrl,
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
          organizerName: event.moderatorName ?? 'Eventi DTD',
          organizerEmail:
            event.moderatorEmail ??
            process.env.SMTP_FROM ??
            'noreply@dominio.gov.it',
        });

        await sendEmail({
          to: recipientEmail,
          subject: reminderSubject(locale, title),
          html: reminderHtml(templateInput),
          text: reminderText(templateInput),
          attachments: [
            {
              filename: 'event.ics',
              content: icsContent,
              contentType: 'text/calendar; charset=utf-8; method=REQUEST',
            },
          ],
        });

        await prisma.registration.update({
          where: { id: reg.id },
          data: { reminderSentAt: new Date() },
        });

        sent++;
      } catch (err) {
        console.error(
          `[cron/reminders] Failed to send reminder to registration ${reg.id}:`,
          err,
        );
        failed++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    eventsProcessed: events.length,
    remindersSent: sent,
    remindersFailed: failed,
  });
}
