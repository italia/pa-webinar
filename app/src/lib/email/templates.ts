/**
 * HTML email templates for confirmation and reminder emails.
 * Clean inline-styled HTML — no external images or CSS frameworks.
 */

type Locale = 'it' | 'en';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface EmailTemplateInput {
  locale: Locale;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventDuration: string;
  joinUrl: string;
  eventPageUrl: string;
  offsetMinutes?: number;
  calendarLinks?: {
    google: string;
    outlook: string;
    yahoo: string;
    icsDownload: string;
  };
  siteName?: string;
  organizationFooter?: string;
}

interface LocaleCopy {
  confirmationSubject: (title: string) => string;
  reminderSubject: (title: string, offsetMinutes: number) => string;
  confirmationHeading: string;
  reminderHeading: string;
  reminderNote: (offsetMinutes: number) => string;
  eventLabel: string;
  dateLabel: string;
  timeLabel: string;
  durationLabel: string;
  joinLabel: string;
  keepNote: string;
  viewEvent: string;
  addToCalendar: string;
  downloadIcs: string;
  footer: string;
  unsubscribe: string;
}

const copy: Record<Locale, LocaleCopy> = {
  it: {
    confirmationSubject: (title) => `Conferma registrazione: ${title}`,
    reminderSubject: (title, offsetMinutes) => {
      if (offsetMinutes >= 1440) return `Promemoria: ${title} inizia domani`;
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `Promemoria: ${title} inizia tra ${hours} or${hours === 1 ? 'a' : 'e'}`;
      }
      return `Promemoria: ${title} inizia tra ${offsetMinutes} minuti`;
    },
    confirmationHeading: 'Registrazione confermata',
    reminderHeading: 'Promemoria evento',
    reminderNote: (offsetMinutes) => {
      if (offsetMinutes >= 1440) {
        return 'L\u2019evento a cui sei registrato inizia domani. Usa il link qui sotto per accedere.';
      }
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `L\u2019evento a cui sei registrato inizia tra ${hours} or${hours === 1 ? 'a' : 'e'}. Usa il link qui sotto per accedere.`;
      }
      return `L\u2019evento a cui sei registrato inizia tra ${offsetMinutes} minuti. Usa il link qui sotto per accedere.`;
    },
    eventLabel: 'Evento',
    dateLabel: 'Data',
    timeLabel: 'Ora',
    durationLabel: 'Durata',
    joinLabel: 'Accedi all\u2019evento',
    keepNote:
      'Conserva questa email, contiene il tuo link personale per accedere all\u2019evento.',
    viewEvent: 'Visualizza la pagina dell\u2019evento',
    addToCalendar: 'Aggiungi al tuo calendario:',
    downloadIcs: 'Scarica .ics',
    footer: '',
    unsubscribe:
      'Ricevi questa email perch\u00e9 ti sei registrato all\u2019evento. Nessuna azione ulteriore \u00e8 necessaria per disiscriverti.',
  },
  en: {
    confirmationSubject: (title) => `Registration confirmed: ${title}`,
    reminderSubject: (title, offsetMinutes) => {
      if (offsetMinutes >= 1440) return `Reminder: ${title} starts tomorrow`;
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `Reminder: ${title} starts in ${hours} hour${hours === 1 ? '' : 's'}`;
      }
      return `Reminder: ${title} starts in ${offsetMinutes} minutes`;
    },
    confirmationHeading: 'Registration confirmed',
    reminderHeading: 'Event reminder',
    reminderNote: (offsetMinutes) => {
      if (offsetMinutes >= 1440) {
        return 'The event you registered for starts tomorrow. Use the link below to join.';
      }
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `The event you registered for starts in ${hours} hour${hours === 1 ? '' : 's'}. Use the link below to join.`;
      }
      return `The event you registered for starts in ${offsetMinutes} minutes. Use the link below to join.`;
    },
    eventLabel: 'Event',
    dateLabel: 'Date',
    timeLabel: 'Time',
    durationLabel: 'Duration',
    joinLabel: 'Join the event',
    keepNote:
      'Keep this email \u2014 it contains your personal link to access the event.',
    viewEvent: 'View event page',
    addToCalendar: 'Add to your calendar:',
    downloadIcs: 'Download .ics',
    footer: '',
    unsubscribe:
      'You are receiving this email because you registered for the event. No further action is needed to unsubscribe.',
  },
};

function layout(heading: string, body: string, footerText: string, locale: Locale = 'it', siteName = 'Eventi PA'): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f7;font-family:'Titillium Web',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" style="background:#f5f6f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:100%;">

<!-- Header -->
<tr><td style="background:#06c;padding:20px 24px;">
  <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:0.5px;">${escapeHtml(siteName)}</span>
</td></tr>

<!-- Heading -->
<tr><td style="padding:32px 24px 8px;">
  <h1 style="margin:0;font-size:24px;color:#17324d;">${heading}</h1>
</td></tr>

<!-- Body -->
<tr><td style="padding:16px 24px 32px;font-size:16px;line-height:1.6;color:#33475b;">
${body}
</td></tr>

<!-- Footer -->
<tr><td style="background:#f5f6f7;padding:16px 24px;font-size:12px;color:#5c6f82;text-align:center;">
  ${footerText}
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function detailsTable(
  c: LocaleCopy,
  input: EmailTemplateInput,
): string {
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;">
<tr>
  <td style="padding:8px 12px;font-weight:600;color:#17324d;width:100px;">${c.eventLabel}</td>
  <td style="padding:8px 12px;">${escapeHtml(input.eventTitle)}</td>
</tr>
<tr style="background:#f5f6f7;">
  <td style="padding:8px 12px;font-weight:600;color:#17324d;">${c.dateLabel}</td>
  <td style="padding:8px 12px;">${escapeHtml(input.eventDate)}</td>
</tr>
<tr>
  <td style="padding:8px 12px;font-weight:600;color:#17324d;">${c.timeLabel}</td>
  <td style="padding:8px 12px;">${escapeHtml(input.eventTime)}</td>
</tr>
<tr style="background:#f5f6f7;">
  <td style="padding:8px 12px;font-weight:600;color:#17324d;">${c.durationLabel}</td>
  <td style="padding:8px 12px;">${escapeHtml(input.eventDuration)}</td>
</tr>
</table>`;
}

function calendarLinksSection(
  c: LocaleCopy,
  links: NonNullable<EmailTemplateInput['calendarLinks']>,
): string {
  const linkStyle =
    'color:#0066CC;text-decoration:none;font-size:14px;white-space:nowrap;';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;">
<tr><td colspan="4" style="padding-bottom:8px;font-size:14px;color:#455B71;">${c.addToCalendar}</td></tr>
<tr>
  <td style="padding-right:16px;"><a href="${links.google}" style="${linkStyle}">📅 Google</a></td>
  <td style="padding-right:16px;"><a href="${links.outlook}" style="${linkStyle}">📅 Outlook</a></td>
  <td style="padding-right:16px;"><a href="${links.yahoo}" style="${linkStyle}">📅 Yahoo</a></td>
  <td><a href="${links.icsDownload}" style="${linkStyle}">⬇️ ${c.downloadIcs}</a></td>
</tr>
</table>`;
}

function ctaButton(label: string, url: string): string {
  return `<table role="presentation" style="margin:24px 0;"><tr><td>
<a href="${url}" style="display:inline-block;padding:12px 28px;background:#06c;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;font-size:16px;">
${label}
</a>
</td></tr></table>`;
}

export function confirmationSubject(
  locale: Locale,
  eventTitle: string,
): string {
  return copy[locale].confirmationSubject(eventTitle);
}

export function reminderSubject(locale: Locale, eventTitle: string, offsetMinutes = 60): string {
  return copy[locale].reminderSubject(eventTitle, offsetMinutes);
}

export function confirmationHtml(input: EmailTemplateInput): string {
  const c = copy[input.locale];
  const calendarHtml = input.calendarLinks
    ? calendarLinksSection(c, input.calendarLinks)
    : '';
  const footerText = input.organizationFooter || c.footer;
  const body = `
${detailsTable(c, input)}
${ctaButton(c.joinLabel, input.joinUrl)}
${calendarHtml}
<p style="margin:16px 0 0;padding:12px 16px;background:#fff3cd;border-left:4px solid #ffc107;border-radius:2px;font-size:14px;color:#664d03;">
  ⚠️ ${c.keepNote}
</p>
<p style="margin:16px 0 0;font-size:14px;"><a href="${input.eventPageUrl}" style="color:#06c;">${c.viewEvent}</a></p>`;

  return layout(c.confirmationHeading, body, `${footerText}<br>${c.unsubscribe}`, input.locale, input.siteName);
}

export function confirmationText(input: EmailTemplateInput): string {
  const c = copy[input.locale];
  const footerText = input.organizationFooter || c.footer;
  const calendarBlock = input.calendarLinks
    ? [
        '',
        c.addToCalendar,
        `Google Calendar: ${input.calendarLinks.google}`,
        `Outlook: ${input.calendarLinks.outlook}`,
        `Yahoo: ${input.calendarLinks.yahoo}`,
        `${c.downloadIcs}: ${input.calendarLinks.icsDownload}`,
      ]
    : [];
  return [
    c.confirmationHeading,
    '',
    `${c.eventLabel}: ${input.eventTitle}`,
    `${c.dateLabel}: ${input.eventDate}`,
    `${c.timeLabel}: ${input.eventTime}`,
    `${c.durationLabel}: ${input.eventDuration}`,
    '',
    `${c.joinLabel}: ${input.joinUrl}`,
    ...calendarBlock,
    '',
    c.keepNote,
    '',
    `${c.viewEvent}: ${input.eventPageUrl}`,
    '',
    footerText,
  ].join('\n');
}

export function reminderHtml(input: EmailTemplateInput): string {
  const c = copy[input.locale];
  const offset = input.offsetMinutes ?? 60;
  const calendarHtml = input.calendarLinks
    ? calendarLinksSection(c, input.calendarLinks)
    : '';
  const footerText = input.organizationFooter || c.footer;
  const body = `
<p style="margin:0 0 16px;">${c.reminderNote(offset)}</p>
${detailsTable(c, input)}
${ctaButton(c.joinLabel, input.joinUrl)}
${calendarHtml}
<p style="margin:16px 0 0;font-size:14px;"><a href="${input.eventPageUrl}" style="color:#06c;">${c.viewEvent}</a></p>`;

  return layout(c.reminderHeading, body, `${footerText}<br>${c.unsubscribe}`, input.locale, input.siteName);
}

export function reminderText(input: EmailTemplateInput): string {
  const c = copy[input.locale];
  const offset = input.offsetMinutes ?? 60;
  const footerText = input.organizationFooter || c.footer;
  const calendarBlock = input.calendarLinks
    ? [
        '',
        c.addToCalendar,
        `Google Calendar: ${input.calendarLinks.google}`,
        `Outlook: ${input.calendarLinks.outlook}`,
        `Yahoo: ${input.calendarLinks.yahoo}`,
        `${c.downloadIcs}: ${input.calendarLinks.icsDownload}`,
      ]
    : [];
  return [
    c.reminderHeading,
    '',
    c.reminderNote(offset),
    '',
    `${c.eventLabel}: ${input.eventTitle}`,
    `${c.dateLabel}: ${input.eventDate}`,
    `${c.timeLabel}: ${input.eventTime}`,
    `${c.durationLabel}: ${input.eventDuration}`,
    '',
    `${c.joinLabel}: ${input.joinUrl}`,
    ...calendarBlock,
    '',
    `${c.viewEvent}: ${input.eventPageUrl}`,
    '',
    footerText,
  ].join('\n');
}
