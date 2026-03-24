/**
 * Generate "Add to Calendar" URLs for Google, Outlook, and Yahoo.
 * Used both server-side (in email templates) and client-side (in UI dropdown).
 */

export interface CalendarLinkInput {
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  joinUrl: string;
}

function toGoogleDateFormat(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function generateGoogleCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${toGoogleDateFormat(input.startsAt)}/${toGoogleDateFormat(input.endsAt)}`,
    details: `${input.description}\n\n${input.joinUrl}`,
    location: input.joinUrl,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function generateOutlookCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    rru: 'addevent',
    subject: input.title,
    startdt: input.startsAt.toISOString(),
    enddt: input.endsAt.toISOString(),
    body: `${input.description}\n\n${input.joinUrl}`,
    location: input.joinUrl,
  });
  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}

export function generateYahooCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    v: '60',
    title: input.title,
    st: toGoogleDateFormat(input.startsAt),
    et: toGoogleDateFormat(input.endsAt),
    desc: `${input.description}\n\n${input.joinUrl}`,
    in_loc: input.joinUrl,
  });
  return `https://calendar.yahoo.com/?${params.toString()}`;
}

export function generateIcsDownloadUrl(
  eventSlug: string,
  baseUrl: string,
): string {
  return `${baseUrl}/api/events/${eventSlug}/calendar.ics`;
}
